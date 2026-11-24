const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const { request: rawRequest } = require('node:http');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { createServer } = require('../server.cjs');

test('Docker archive and CI forward a separate administrator token to the web image', () => {
  const docs = readFileSync(join(__dirname, '../README.md'), 'utf8');
  const archive = docs.split('### Run from an archive instead')[1];
  assert.match(archive, /docker run[^\n]*-e LOGS_ADMIN_TOKEN/);
  const workflow = readFileSync(join(__dirname, '../../../.github/workflows/ci.yml'), 'utf8');
  const smoke = workflow.split('Load and start the exported image')[1].split('Run the Logs web browser tests')[0];
  assert.match(smoke, /docker run[^\n]*--env LOGS_ADMIN_TOKEN/);
  assert.match(smoke, /LOGS_WEB_TEST_ADMIN_TOKEN=\$LOGS_ADMIN_TOKEN/);
});

const admin = randomBytes(32).toString('hex');
const legacy = randomBytes(32).toString('hex');
async function start(options) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { method = 'GET', credential, body, headers = {} } = {}) => fetch(origin + path, {
    method, headers: { ...(credential && { Authorization: `Bearer ${credential}` }), ...(body && { 'Content-Type': 'application/json' }), ...headers },
    body: body && JSON.stringify(body),
  });
  const rawStatus = headers => new Promise((resolve, reject) => {
    rawRequest(origin + '/api/keys', { headers: { Authorization: `Bearer ${admin}`, ...headers } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject).end();
  });
  return { request, rawStatus, stop: () => new Promise(resolve => server.close(resolve)) };
}
const path = '/api/keys';
const launch = (request, credential = admin, name = 'Billing worker') => request(path, { method: 'POST', credential, body: { name } });
const send = (request, credential, message = 'accepted') => request('/api/logs', {
  method: 'POST', credential, body: { app: 'billing', level: 'INFO', message },
});

test('admin creates independent send-only keys, persists metadata without secrets, and revokes one without affecting the other', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'logs-keys-'));
  const filename = join(dir, 'logs.sqlite');
  const options = { filename, adminToken: admin };
  let running = await start(options);
  t.after(async () => { await running.stop(); await rm(dir, { recursive: true, force: true }); });
  const created = await launch(running.request);
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  const { key, secret } = await created.json();
  assert.match(secret, /^logs_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
  assert.ok(secret.startsWith(key.prefix + '_'));
  assert.equal(key.name, 'Billing worker');
  assert.equal(key.lastUsedAt, null);
  assert.equal(key.revokedAt, null);
  const { secret: other } = await (await launch(running.request, admin, 'Web gateway')).json();
  assert.notEqual(other, secret);
  assert.equal((await running.request(path, { credential: secret })).status, 401);
  assert.equal((await running.request('/api/logs', { credential: secret })).status, 401);
  assert.equal((await send(running.request, admin)).status, 401);
  assert.equal((await send(running.request, secret)).status, 201);
  await running.stop();
  running = await start(options);
  const list = await (await running.request(path, { credential: admin })).json();
  const saved = list.keys.find(entry => entry.id === key.id);
  assert.equal(saved.prefix, key.prefix);
  assert.ok(Number.isFinite(Date.parse(saved.lastUsedAt)));
  assert.ok(!JSON.stringify(list).includes(secret));
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(key.id);
    assert.equal(row.secret_hash.length, 32);
    assert.ok(!JSON.stringify(row).includes(secret));
  } finally { db.close(); }
  const revoke = () => running.request(`${path}/${key.id}`, { method: 'DELETE', credential: admin });
  const revoked = await revoke();
  assert.equal(revoked.status, 200);
  const record = (await revoked.json()).key;
  assert.ok(record.revokedAt);
  assert.equal((await (await revoke()).json()).key.revokedAt, record.revokedAt);
  assert.equal((await send(running.request, secret)).status, 401);
  assert.equal((await send(running.request, other, 'other sender')).status, 201);
  const { events } = await (await running.request('/api/logs')).json();
  assert.deepEqual(events.map(event => event.message), ['other sender', 'accepted']);
});

test('management is opt-in and neither the legacy sender token nor a cross-site browser request can manage keys', async t => {
  const enabled = await start({ adminToken: admin, token: legacy });
  t.after(enabled.stop);
  const disabled = await start({ token: legacy });
  t.after(disabled.stop);
  assert.equal((await enabled.request(path)).status, 401);
  assert.equal((await launch(enabled.request, legacy)).status, 401);
  assert.equal(await enabled.rawStatus({ Host: 'attacker.invalid' }), 403);
  assert.equal(await enabled.rawStatus({ 'Sec-Fetch-Site': 'cross-site' }), 403);
  assert.equal(await enabled.rawStatus({ 'Sec-Fetch-Site': 'same-site' }), 403);
  assert.equal((await launch(enabled.request, admin, '   ')).status, 400);
  assert.equal((await launch(enabled.request, admin, 'x'.repeat(61))).status, 400);
  assert.equal((await launch(disabled.request)).status, 503);
  assert.equal((await send(disabled.request, legacy)).status, 201);
  assert.throws(() => createServer({ adminToken: legacy, token: legacy }), /distinct/);
});