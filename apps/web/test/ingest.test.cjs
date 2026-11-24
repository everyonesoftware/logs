const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { test } = require('node:test');
const { createServer } = require('../server.cjs');

const token = randomBytes(32).toString('hex');
async function start(options) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    stop: () => new Promise(resolve => server.close(resolve)),
  };
}
const read = async url => {
  const response = await fetch(`${url}/api/logs`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
};
const send = (url, event, authorization = `Bearer ${token}`) => fetch(`${url}/api/logs`, {
  method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(event),
});

test('the HTTP receiver starts empty, accepts authenticated events, and retains them across restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'logs-ingest-'));
  let running;
  t.after(async () => { await running?.stop(); await rm(dir, { recursive: true, force: true }); });
  const options = { token, filename: join(dir, 'logs.sqlite') };
  running = await start(options);
  assert.deepEqual((await read(running.url)).events, []);
  const timestamp = new Date().toISOString();
  const event = { timestamp, app: 'worker', level: 'INFO', message: 'worker ready', source: 'startup', requestId: 'r-1' };
  assert.equal((await send(running.url, event, 'Bearer wrong')).status, 401);
  assert.equal((await send(running.url, { ...event, timestamp: 'yesterday' })).status, 400);
  assert.equal((await send(running.url, { ...event, message: 'a'.repeat(70_000) })).status, 413);
  assert.deepEqual((await read(running.url)).events, []);
  const accepted = await send(running.url, event);
  assert.equal(accepted.status, 201);
  const { id } = await accepted.json();
  const second = await send(running.url, { ...event, message: 'second event' });
  assert.equal(second.status, 201);
  const secondId = (await second.json()).id;
  await running.stop();
  running = await start(options);
  assert.deepEqual((await read(running.url)).events, [{ ...event, message: 'second event', id: secondId }, { ...event, id }]);
});

test('absent write credentials disable ingestion without breaking reads', async t => {
  const { url, stop } = await start({ filename: ':memory:', token: '' });
  t.after(stop);
  assert.equal((await send(url, { app: 'worker', level: 'INFO', message: 'worker ready' })).status, 503);
  assert.deepEqual((await read(url)).events, []);
});

test('recent results are bounded and explicitly report truncation', async t => {
  const { url, stop } = await start({ filename: ':memory:', token, retained: 3, windowLimit: 2 });
  t.after(stop);
  for (const message of ['first', 'second', 'third', 'fourth']) {
    assert.equal((await send(url, { app: 'worker', level: 'INFO', message })).status, 201);
  }
  const result = await read(url);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.events.map(event => event.message), ['fourth', 'third']);
});

test('retention prunes the earliest receipt even with space in the read window', async t => {
  const { url, stop } = await start({ token, retained: 2, windowLimit: 10 });
  t.after(stop);
  const now = Date.now();
  for (const [message, offset] of [['received first', 0], ['received second', -5000], ['received third', -10000]]) {
    const timestamp = new Date(now + offset).toISOString();
    assert.equal((await send(url, { timestamp, app: 'worker', level: 'INFO', message })).status, 201);
  }
  const result = await read(url);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.events.map(event => event.message), ['received second', 'received third']);
});
