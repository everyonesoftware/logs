const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { version } = require('./package.json');
const { createLogs } = require('./logs.cjs');

const routes = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/settings.js', ['settings.js', 'text/javascript']],
  ['/styles.css', ['styles.css', 'text/css']],
]);

function createServer(options) {
  const logs = createLogs(options);
  const server = http.createServer({ requestTimeout: 15_000, headersTimeout: 10_000, connectionsCheckingInterval: 1_000 }, async (request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    const path = request.url.split('?', 1)[0];
    const keyPath = path === '/api/keys' || path.startsWith('/api/keys/');
    if (path === '/api/logs' || keyPath) {
      try {
        if (keyPath) await logs.handleKeys(request, response, path);
        else await logs.handle(request, response);
      }
      catch {
        if (!response.headersSent && !response.destroyed) response.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8', Connection: 'close',
        }).end(JSON.stringify({ error: keyPath ? 'keys_unavailable' : 'logs_unavailable' }));
      }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (path === '/version.json') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ version, keysConfigured: logs.keysConfigured }));
      return;
    }
    const asset = routes.get(path);
    if (!asset) { response.writeHead(404).end(); return; }
    try {
      const content = await readFile(resolve(__dirname, asset[0]));
      response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }).end(content);
    } catch {
      response.writeHead(500).end();
    }
  });
  server.on('close', logs.close);
  return server;
}

module.exports = { createServer };

if (require.main === module) {
  process.umask(0o077);
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 4173);
  const server = createServer({
    filename: process.env.LOGS_DB_PATH || resolve(__dirname, 'data', 'logs.sqlite'),
    token: process.env.LOGS_INGEST_TOKEN,
    adminToken: process.env.LOGS_ADMIN_TOKEN,
    allowedHost: process.env.LOGS_ALLOWED_HOST,
  });
  server.listen(port, host, () => console.log(`Logs listening at http://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`));
}
