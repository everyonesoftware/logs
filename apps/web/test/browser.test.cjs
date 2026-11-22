const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createServer } = require('../server.cjs');
const sample = require('../../../contracts/sample.json');

let server, browser, url;
before(async () => {
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
});
after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
});
async function visit(t, options) {
  const page = await browser.newPage(options);
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(url);
  await page.getByRole('status').filter({ hasText: /\d+ events/ }).waitFor();
  return page;
}
const row = page => page.locator('#rows button');
const seconds = value => value.split(':').map(Number).reduce((acc, part) => acc * 60 + part, 0);
const within = (minutes, events = sample.events) => events.filter(event => {
  const time = seconds(event.time);
  return time >= seconds(sample.end) - minutes * 60 && time <= seconds(sample.end);
}).sort((a, b) => seconds(b.time) - seconds(a.time));
async function expectEvents(page, expected) {
  assert.deepEqual(await row(page).evaluateAll(rows => rows.map(r => r.dataset.event)), expected.map(e => e.id));
}

test('the workspace and browser tab are branded Logs', async t => {
  const page = await visit(t);
  assert.equal(await page.title(), 'Logs — Investigate');
  assert.equal(await page.locator('header .brand').innerText(), 'Logs');
});

test('investigation lists real fixture events newest-first and intersects search and filters', async t => {
  const page = await visit(t);
  const workspace = page.getByRole('main');
  assert.doesNotMatch(await workspace.innerText(), /Workspace \/ Investigate|\bInvestigate\b|Compare log events|Focus search|Esc Close event|Sample timeline ends/i);
  assert.equal(await workspace.getByRole('searchbox').isVisible(), true);
  assert.equal(await page.getByText('Design study').count(), 0);
  assert.equal(await page.getByText('Sample data', { exact: true }).count(), 1);
  const initial = within(30);
  await expectEvents(page, initial);
  const event = initial.find(e => e.level === 'ERROR');
  const search = page.getByRole('searchbox');
  await page.keyboard.press('/');
  assert.equal(await search.evaluate(e => document.activeElement === e), true);
  for (const field of ['message', 'source', 'requestId']) {
    const value = event[field];
    await search.fill(`  ${value.toUpperCase()}  `);
    await expectEvents(page, initial.filter(e => [e.message, e.source, e.requestId].some(v => v.toLowerCase().includes(value.toLowerCase()))));
  }
  await page.getByLabel('Application', { exact: true }).selectOption(event.app);
  await page.getByLabel('Severity', { exact: true }).selectOption('ERROR');
  await expectEvents(page, initial.filter(e => e.app === event.app && e.level === 'ERROR' && [e.message, e.source, e.requestId].some(v => v.toLowerCase().includes(event.requestId.toLowerCase()))));
  await search.fill('<no matching events>');
  assert.equal(await page.getByText(/No events match/).isVisible(), true);
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expectEvents(page, initial);
  const range = page.getByLabel('Time range');
  for (const minutes of [10, 60]) {
    await range.selectOption(String(minutes));
    await expectEvents(page, within(minutes));
  }
});

test('chart plots the fixture and either spike control narrows to the same metric window', async t => {
  const page = await visit(t);
  const { metric } = sample;
  assert.equal(await page.locator('#value').innerText(), `${metric.values.at(-1)} ${metric.unit}`);
  assert.equal((await page.locator('#line').getAttribute('d')).split('L').length, metric.values.length);
  assert.match(await page.getByRole('img', { name: /HTTP error rate/ }).getAttribute('aria-label'), /peak 12\.4% at 14:32 UTC/);
  const expected = within(30).filter(e => e.app === metric.app && seconds(e.time) >= seconds(metric.windowStart) && seconds(e.time) < seconds(metric.windowEnd));
  const search = page.getByRole('searchbox');
  const app = page.getByLabel('Application', { exact: true });
  const severity = page.getByLabel('Severity', { exact: true });
  const range = page.getByLabel('Time range');
  const clear = page.getByRole('button', { name: 'Clear window' });
  for (const [selector, minutes] of [['#peak', 60], ['#jump', 10]]) {
    await range.selectOption(String(minutes));
    await search.fill('not found');
    await app.selectOption('Storage');
    await severity.selectOption('INFO');
    await page.locator(selector).click();
    await expectEvents(page, expected);
    assert.equal(await app.inputValue(), metric.app);
    assert.equal(await search.inputValue(), '');
    assert.equal(await severity.inputValue(), '');
    assert.equal(await clear.evaluate(e => e === document.activeElement), true);
    await clear.click();
    await expectEvents(page, within(minutes === 10 ? 30 : 60).filter(e => e.app === metric.app));
    assert.equal(await app.evaluate(e => e === document.activeElement), true);
  }
});

test('correlation includes the exact start and excludes the exact end', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const { metric } = sample;
  const event = sample.events.find(e => e.app === metric.app);
  const events = [...sample.events, { ...event, id: 'start', time: metric.windowStart }, { ...event, id: 'end', time: metric.windowEnd }];
  await page.route('**/sample.json', route => route.fulfill({ json: { ...sample, events } }));
  await page.goto(url);
  await page.locator('#jump').click();
  assert.equal(await row(page).filter({ hasText: metric.windowStart }).count(), 1);
  assert.equal(await row(page).filter({ hasText: metric.windowEnd }).count(), 0);
});

test('event details support keyboard and pointer and return focus on close', async t => {
  const page = await visit(t);
  const event = sample.events.find(e => e.source === 'http');
  const record = row(page).filter({ hasText: event.message });
  const detail = page.getByRole('region', { name: 'Event details' });
  const close = page.getByRole('button', { name: 'Close event details' });
  await record.focus();
  await page.keyboard.press('Enter');
  assert.equal(await detail.getByRole('heading', { name: event.message }).isVisible(), true);
  for (const field of [`${event.time} UTC`, event.app, event.source, event.requestId]) {
    assert.equal(await detail.getByText(field, { exact: true }).isVisible(), true);
  }
  assert.equal(await close.evaluate(e => e === document.activeElement), true);
  assert.equal(await record.getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await detail.isVisible(), false);
  assert.equal(await record.evaluate(e => e === document.activeElement), true);
  await record.click();
  await close.click();
  assert.equal(await record.evaluate(e => e === document.activeElement), true);
  await record.click();
  await page.getByLabel('Application', { exact: true }).selectOption('Storage');
  assert.equal(await detail.isVisible(), false);
  assert.equal(await page.locator('#detail').innerText(), '');
});

test('phone viewport fits the workspace and settings reports no release channel', async t => {
  const page = await visit(t, { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 360);
  await page.locator('#jump').tap();
  await row(page).first().tap();
  const detail = page.getByRole('region', { name: 'Event details' });
  assert.equal(await detail.isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 360);
  const button = page.getByRole('button', { name: 'Settings', exact: true });
  await button.tap();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const { version } = require('../package.json');
  await dialog.getByRole('heading', { name: `Current Version: ${version}` }).waitFor();
  await dialog.getByRole('button', { name: 'Check for updates' }).tap();
  assert.match(await dialog.getByRole('status').innerText(), /unavailable.*no web release channel/i);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await button.evaluate(e => e === document.activeElement), true);
  assert.equal(await detail.isVisible(), true);
  await button.tap();
  await dialog.getByRole('button', { name: 'Close settings' }).tap();
  assert.equal(await dialog.isVisible(), false);
});

test('failed fixture load is explicit and the workspace recovers on reload', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route('**/sample.json', route => route.fulfill({ status: 503 }));
  await page.goto(url);
  await page.getByRole('status').filter({ hasText: 'Sample data could not be loaded' }).waitFor();
  assert.equal(await page.getByRole('searchbox').isVisible(), false);
  await page.unroute('**/sample.json');
  await page.reload();
  await page.getByRole('searchbox').waitFor();
});

test('server exposes only explicitly mapped read-only assets', async () => {
  const fixture = await fetch(`${url}/sample.json`);
  assert.deepEqual(await fixture.json(), sample);
  assert.match(fixture.headers.get('content-type'), /application\/json/);
  assert.equal((await fetch(`${url}/styles.css`, { method: 'HEAD' })).status, 200);
  for (const path of ['/mockups/Logs.html', '/server.cjs', '/contracts/sample.json', '/ingest']) {
    assert.equal((await fetch(url + path)).status, 404);
  }
  const post = await fetch(`${url}/sample.json`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});
