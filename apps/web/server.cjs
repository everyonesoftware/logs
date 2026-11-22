const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { version } = require('./package.json');

const routes = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/sample.json', ['../../contracts/sample.json', 'application/json']],
]);

function createServer() {
  return http.createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const path = request.url.split('?', 1)[0];
    if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (path === '/version.json') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ version }));
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
}

module.exports = { createServer };

if (require.main === module) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 4173);
  const server = createServer();
  server.listen(port, host, () => console.log(`Logs listening at http://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`));
}
