const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const maxBody = 64 * 1024;
const levels = new Set(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
const digest = value => createHash('sha256').update(value).digest();
const managedBearer = /^Bearer logs_([a-f0-9]{16})_[A-Za-z0-9_-]{43}$/i;
const json = (response, status, body, headers) => response.writeHead(status, {
  'Content-Type': 'application/json; charset=utf-8', ...headers,
}).end(JSON.stringify(body));

function parseEvent(body) {
  const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid event');
  const fields = { timestamp: 24, app: 100, level: 5, message: 4096, source: 256, requestId: 256 };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(fields, key) || typeof value !== 'string' || Buffer.byteLength(value) > fields[key] || value.includes('\0')) throw new Error('invalid field');
  }
  const { timestamp = new Date().toISOString(), app, level, message, source = '', requestId = '' } = input;
  if (!app?.trim() || !levels.has(level) || !message?.trim() ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(timestamp)) throw new Error('invalid event');
  const time = new Date(timestamp);
  if (!Number.isFinite(+time) || time.toISOString() !== (timestamp.length === 20 ? timestamp.replace('Z', '.000Z') : timestamp)) {
    throw new Error('invalid timestamp');
  }
  return { timestamp: time.toISOString(), app, level, message, source, requestId };
}

async function readBody(request, limit) {
  if (Number(request.headers['content-length']) > limit) return null;
  let size = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function createLogs({ filename = ':memory:', token = '', adminToken = '', retained = 10_000, windowLimit = 200, allowedHost = '' }) {
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (allowedHost) {
    if (!/^[a-zA-Z0-9.-]+$/.test(allowedHost)) throw new Error('LOGS_ALLOWED_HOST must be a hostname without a scheme or port');
    hosts.add(allowedHost.toLowerCase());
  }
  if (token && !/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error('LOGS_INGEST_TOKEN must contain at least 32 URL-safe characters');
  if (token && managedBearer.test(`Bearer ${token}`)) throw new Error('LOGS_INGEST_TOKEN must not use the managed key format');
  if (adminToken && !/^[A-Za-z0-9_-]{32,256}$/.test(adminToken)) throw new Error('LOGS_ADMIN_TOKEN must contain 32–256 URL-safe characters');
  if (adminToken && (adminToken === token || managedBearer.test(`Bearer ${adminToken}`))) throw new Error('LOGS_ADMIN_TOKEN must be distinct from sender keys');
  const key = token && digest(`Bearer ${token}`);
  const adminKey = adminToken && digest(`Bearer ${adminToken}`);
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename, { timeout: 100 });
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL,
      app TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL,
      source TEXT NOT NULL, requestId TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_time ON events(timestamp DESC, seq DESC);
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, secret_hash BLOB NOT NULL,
      created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT
    );
  `);
  const insert = db.prepare('INSERT INTO events(timestamp, app, level, message, source, requestId) VALUES (?, ?, ?, ?, ?, ?)');
  const prune = db.prepare('DELETE FROM events WHERE seq <= ?');
  const recent = db.prepare(`SELECT CAST(seq AS TEXT) AS id, timestamp, app, level, message, source, requestId
    FROM events WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp DESC, seq DESC LIMIT ?`);
  const metadata = `id, name, 'logs_' || id AS prefix, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt`;
  const listKeys = db.prepare(`SELECT ${metadata} FROM api_keys ORDER BY created_at DESC, rowid DESC`);
  const getKey = db.prepare(`SELECT ${metadata} FROM api_keys WHERE id = ?`);
  const addKey = db.prepare('INSERT INTO api_keys(id, name, secret_hash, created_at) VALUES (?, ?, ?, ?)');
  const revokeKey = db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL');
  const activeKey = db.prepare('SELECT secret_hash FROM api_keys WHERE id = ? AND revoked_at IS NULL');
  const markUsed = db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?');
  const reject = (response, status, error, headers) => json(response, status, { error }, { Connection: 'close', ...headers });
  const unauthorized = response => reject(response, 401, 'unauthorized', { 'WWW-Authenticate': 'Bearer' });
  const hostAllowed = request => {
    const host = /^(\[::1\]|[a-zA-Z0-9.-]+)(?::\d{1,5})?$/.exec(request.headers.host || '');
    return host && hosts.has(host[1].toLowerCase());
  };
  const validManaged = (id, supplied) => {
    const row = activeKey.get(id);
    return row && timingSafeEqual(row.secret_hash, supplied);
  };

  return {
    close: () => db.close(),
    keysConfigured: Boolean(adminKey),
    async handleKeys(request, response, path) {
      if (!hostAllowed(request)) return reject(response, 403, 'host_not_allowed');
      const site = request.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return reject(response, 403, 'cross_origin');
      if (!adminKey) return reject(response, 503, 'management_disabled');
      if (!timingSafeEqual(adminKey, digest(request.headers.authorization || ''))) return unauthorized(response);
      if (path === '/api/keys') {
        if (request.method === 'GET') return json(response, 200, { keys: listKeys.all() });
        if (request.method !== 'POST') return reject(response, 405, 'method_not_allowed', { Allow: 'GET, POST' });
        if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return reject(response, 415, 'expected_json');
        }
        const body = await readBody(request, 2048);
        if (!body) return reject(response, 413, 'request_too_large');
        let input;
        try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
        catch { return reject(response, 400, 'invalid_name'); }
        const name = typeof input?.name === 'string' ? input.name.trim() : '';
        if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name) || Object.keys(input).length !== 1) {
          return reject(response, 400, 'invalid_name');
        }
        const id = randomBytes(8).toString('hex');
        const secret = `logs_${id}_${randomBytes(32).toString('base64url')}`;
        const createdAt = new Date().toISOString();
        addKey.run(id, name, digest(secret), createdAt);
        return json(response, 201, { key: { id, name, prefix: `logs_${id}`, createdAt, lastUsedAt: null, revokedAt: null }, secret });
      }
      const match = /^\/api\/keys\/([a-f0-9]{16})$/.exec(path);
      if (!match) return reject(response, 404, 'not_found');
      if (request.method !== 'DELETE') return reject(response, 405, 'method_not_allowed', { Allow: 'DELETE' });
      const id = match[1];
      revokeKey.run(new Date().toISOString(), id);
      const revoked = getKey.get(id);
      return revoked ? json(response, 200, { key: revoked }) : reject(response, 404, 'not_found');
    },
    async handle(request, response) {
      if (!hostAllowed(request)) return reject(response, 403, 'host_not_allowed');
      const authorization = request.headers.authorization || '';
      const managedId = managedBearer.exec(authorization)?.[1];
      if (request.method === 'GET' || request.method === 'HEAD') {
        if (managedId) return unauthorized(response);
        const now = new Date();
        const events = recent.all(new Date(+now - 3_600_000).toISOString(), now.toISOString(), windowLimit + 1);
        return json(response, 200, { now: now.toISOString(), events: events.slice(0, windowLimit), truncated: events.length > windowLimit, limit: windowLimit });
      }
      if (request.method !== 'POST') return reject(response, 405, 'method_not_allowed', { Allow: 'GET, HEAD, POST' });
      const legacy = key && timingSafeEqual(key, digest(authorization));
      const supplied = managedId && digest(authorization.slice(7));
      if (!legacy && !(managedId && validManaged(managedId, supplied))) {
        return key || adminKey || managedId ? unauthorized(response) : reject(response, 503, 'ingestion_disabled');
      }
      if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return reject(response, 415, 'expected_json');
      const body = await readBody(request, maxBody);
      if (!body) return reject(response, 413, 'request_too_large');
      let event;
      try { event = parseEvent(body); }
      catch { return reject(response, 400, 'invalid_event'); }
      db.exec('BEGIN IMMEDIATE');
      let id;
      try {
        if (!legacy && !validManaged(managedId, supplied)) {
          db.exec('ROLLBACK');
          return unauthorized(response);
        }
        const { lastInsertRowid } = insert.run(event.timestamp, event.app, event.level, event.message, event.source, event.requestId);
        prune.run(lastInsertRowid - retained);
        if (!legacy) markUsed.run(new Date().toISOString(), managedId);
        db.exec('COMMIT');
        id = String(lastInsertRowid);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return json(response, 201, { id });
    },
  };
}

module.exports = { createLogs };
