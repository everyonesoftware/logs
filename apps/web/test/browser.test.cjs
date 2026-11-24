const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { before, after, test } = require('node:test');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createServer } = require('../server.cjs');
const sample = require('../../../contracts/sample.json');

let server, browser, url;
const token = process.env.LOGS_WEB_TEST_TOKEN || randomBytes(32).toString('hex');
const adminToken = randomBytes(32).toString('hex');
before(async () => {
  url = process.env.LOGS_WEB_TEST_URL;
  if (url) {
    const target = new URL(url);
    assert.equal(target.protocol, 'http:');
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Use a disposable loopback target.');
    assert.ok(process.env.LOGS_WEB_TEST_TOKEN && process.env.LOGS_WEB_TEST_ADMIN_TOKEN, 'Provide both disposable test credentials.');
  }
  if (!url) {
    server = createServer({ token, adminToken });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  }
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
  await mockInvestigation(page);
  await page.goto(url);
  await page.getByRole('status').filter({ hasText: /\d+ events/ }).waitFor();
  return page;
}
const mockInvestigation = (page, fixture = sample) => page.route('**/api/logs', route => route.fulfill({ json: fixture }));
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
  await mockInvestigation(page, { ...sample, events });
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

async function expectIndependentDesktopScroll(t, viewport) {
  const page = await visit(t, { viewport });
  const scroller = page.getByRole('region', { name: 'Log entries' });
  const positions = () => page.evaluate(() => ({
    viewport: innerHeight,
    document: document.documentElement.scrollHeight,
    pageScroll: scrollY,
    mast: document.querySelector('.mast').getBoundingClientRect().top,
    search: document.querySelector('.search').getBoundingClientRect().top,
    toolbar: document.querySelector('.toolbar').getBoundingClientRect().top,
    columns: document.querySelector('.log-head').getBoundingClientRect().top,
    timeline: document.querySelector('.metric').getBoundingClientRect().top,
  }));
  const before = await positions();
  assert.equal(before.document, before.viewport);
  assert.equal(await scroller.evaluate(el => el.scrollHeight > el.clientHeight), true);
  await scroller.hover();
  await page.mouse.wheel(0, 2500);
  await page.waitForFunction(() => {
    const el = document.querySelector('[aria-label="Log entries"]');
    return el.scrollTop > 0 && Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 1;
  });
  assert.deepEqual(await positions(), before);
  await page.mouse.wheel(0, 2500);
  const last = row(page).last();
  await last.click();
  assert.equal(await page.getByRole('region', { name: 'Event details' }).isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await last.evaluate(el => document.activeElement === el), true);
  await scroller.focus();
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.querySelector('[aria-label="Log entries"]').scrollTop === 0);
  assert.deepEqual(await positions(), before);
}

for (const viewport of [{ width: 1360, height: 680 }, { width: 1128, height: 620 }, { width: 800, height: 450 }]) {
  test(`${viewport.width}×${viewport.height}: log rows scroll without moving the page, headings, or timeline`,
    t => expectIndependentDesktopScroll(t, viewport));
}

test('a scoped event has a readable detail pane in a short desktop window', async t => {
  const page = await visit(t, { viewport: { width: 791, height: 450 } });
  await page.locator('#jump').click();
  await row(page).first().click();
  const detail = page.getByRole('region', { name: 'Event details' });
  const body = detail.locator('.detail-body');
  const height = await body.evaluate(el => el.clientHeight);
  assert.ok(height >= 100, `Expected readable event details, got ${height}px`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), 450);
  await detail.getByText('req-74a3', { exact: true }).scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('region', { name: 'Metric timeline' }).isVisible(), true);
  assert.equal(await row(page).first().evaluate(el => document.activeElement === el), true);
});

test('the stacked layout scrolls log rows independently and still lets the page reach the timeline', async t => {
  const page = await visit(t, { viewport: { width: 760, height: 560 } });
  const scroller = page.getByRole('region', { name: 'Log entries' });
  const timeline = page.getByRole('region', { name: 'Metric timeline' });
  assert.equal(await scroller.evaluate(el => el.scrollHeight > el.clientHeight), true);
  await scroller.hover();
  await page.mouse.wheel(0, 2500);
  await page.waitForFunction(() => document.querySelector('.log-scroll').scrollTop > 0);
  assert.equal(await page.evaluate(() => scrollY), 0);
  const jump = timeline.locator('#jump');
  assert.equal(await jump.evaluate(el => el.getBoundingClientRect().bottom > innerHeight), true);
  await page.mouse.move(5, 300); // Page margin, outside the log pane.
  await page.mouse.wheel(0, 2500);
  await page.waitForFunction(() => scrollY > 0 && document.querySelector('#jump').getBoundingClientRect().bottom <= innerHeight);
  await jump.click();
  await page.getByRole('button', { name: 'Clear window' }).waitFor();
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
  const overview = page.getByRole('main', { name: 'Settings' });
  const version = process.env.LOGS_WEB_TEST_VERSION || require('../package.json').version;
  await overview.getByRole('heading', { name: `Current Version: ${version}` }).waitFor();
  assert.equal(await overview.getByRole('heading', { name: 'API keys' }).isVisible(), true);
  assert.match(await overview.innerText(), /no web release channel/i);
  await page.keyboard.press('Escape');
  assert.equal(await overview.isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'settings');
  assert.equal(await detail.isVisible(), true);
  await button.tap();
  await page.getByRole('button', { name: 'Back to logs' }).tap();
  assert.equal(await overview.isVisible(), false);
});

async function verifySenderKeys(t) {
  let target = url;
  const credential = process.env.LOGS_WEB_TEST_URL ? process.env.LOGS_WEB_TEST_ADMIN_TOKEN : adminToken;
  if (!process.env.LOGS_WEB_TEST_URL) {
    const receiver = createServer({ adminToken });
    await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => receiver.close(resolve)));
    target = `http://127.0.0.1:${receiver.address().port}`;
  }
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(target);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('main', { name: 'Settings' });
  await settings.getByLabel('Administrator token').fill(credential);
  await settings.getByRole('button', { name: 'Unlock' }).click();
  await settings.getByText('No API keys yet.', { exact: true }).waitFor();
  await settings.getByRole('button', { name: 'Create API key' }).click();
  const editor = page.getByRole('dialog', { name: 'Create API key' });
  await editor.getByLabel('Application name').fill('Browser worker');
  await editor.getByRole('button', { name: 'Create API key' }).click();
  const reveal = page.getByRole('dialog', { name: 'API key created' });
  const secret = await reveal.getByLabel('Sender API key').inputValue();
  await reveal.getByRole('button', { name: 'Done' }).click();
  assert.equal(await page.getByLabel('Sender API key').inputValue(), '');
  const send = () => fetch(`${target}/api/logs`, {
    method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ app: 'browser-worker', level: 'INFO', message: 'Managed key accepted' }),
  });
  await page.getByRole('button', { name: 'Back to logs' }).click();
  assert.equal((await send()).status, 201);
  await row(page).filter({ hasText: 'Managed key accepted' }).waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings.getByLabel('Administrator token').fill(credential);
  await settings.getByRole('button', { name: 'Unlock' }).click();
  await settings.getByRole('button', { name: 'Revoke Browser worker' }).click();
  await page.getByRole('dialog', { name: 'Revoke API key?' }).getByRole('button', { name: 'Revoke key' }).click();
  await settings.getByText('Revoked', { exact: true }).waitFor();
  assert.equal((await send()).status, 401);
}

test('failed initial log load is explicit and the workspace retries automatically', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route('**/api/logs', route => route.fulfill({ status: 503 }));
  await page.goto(url);
  await page.getByRole('status').filter({ hasText: 'Could not load logs' }).waitFor();
  assert.equal(await page.getByRole('searchbox').isVisible(), false);
  await page.unroute('**/api/logs');
  await page.getByRole('searchbox').waitFor();
});

test('server exposes only explicitly mapped assets and keeps test fixtures private', async () => {
  assert.equal((await fetch(`${url}/styles.css`, { method: 'HEAD' })).status, 200);
  for (const path of ['/mockups/Logs.html', '/server.cjs', '/sample.json', '/contracts/sample.json', '/ingest']) {
    assert.equal((await fetch(url + path)).status, 404);
  }
  const post = await fetch(`${url}/sample.json`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('the live workspace starts empty and receives a pushed log without a reload', async t => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  t.after(() => page.close());
  await page.goto(url);
  await page.getByText('No logs in the last hour.').waitFor({ timeout: 2500 });
  assert.equal(await page.getByText('Sample data', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('img').count(), 0);
  const search = page.getByRole('searchbox');
  await search.fill('request-live');
  const message = 'Sender connected <img src=x onerror=alert(1)>';
  const timestamp = new Date().toISOString();
  const sent = await fetch(`${url}/api/logs`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ timestamp, app: 'worker', level: 'DEBUG', message, source: 'collector', requestId: 'request-live' }),
  });
  assert.equal(sent.status, 201);
  const item = row(page).filter({ hasText: message });
  await item.waitFor({ timeout: 8000 });
  assert.equal(await search.evaluate(el => el === document.activeElement), true);
  assert.equal(await row(page).locator('img').count(), 0);
  await page.getByLabel('Application', { exact: true }).selectOption('worker');
  await page.getByLabel('Severity', { exact: true }).selectOption('DEBUG');
  await item.tap();
  const detail = page.getByRole('region', { name: 'Event details' });
  assert.equal(await detail.getByRole('heading', { name: message }).isVisible(), true);
  assert.equal(await detail.getByText(timestamp, { exact: true }).isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.route('**/api/logs', route => route.fulfill({ status: 503 }));
  await page.getByText(/Could not refresh logs/).waitFor({ timeout: 8000 });
  assert.equal(await detail.isVisible(), true);
});

// On the packaged server, keep the managed-key write after the legacy empty-viewer check.
test('Settings manages real sender keys and a sent event arrives in the live workspace', verifySenderKeys);
