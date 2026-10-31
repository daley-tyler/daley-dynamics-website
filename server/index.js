import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

import { createEmailSender } from './enquiry/email.js';
import { createEnquiryHandler, isEnquiryRequest } from './enquiry/handler.js';
import { InMemoryRateLimiter } from './enquiry/rate-limit.js';

const production = process.argv.includes('--production');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5173);
const root = resolve(import.meta.dirname, '..');
const distribution = resolve(root, 'dist');

const limiter = new InMemoryRateLimiter();
const handleEnquiry = createEnquiryHandler({
  sendEnquiry: createEmailSender(process.env),
  limiter,
});

let vite;
if (!production) {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({
    root,
    appType: 'mpa',
    server: { middlewareMode: true },
  });
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

async function serveProduction(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
  } catch {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }
  const relativePath = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const filePath = resolve(distribution, `.${relativePath}`);
  if (filePath !== distribution && !filePath.startsWith(`${distribution}${sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
      'Content-Length': file.size,
      'Cache-Control':
        extname(filePath) === '.html'
          ? 'no-cache'
          : /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:css|js|woff2)$/.test(pathname)
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else {
      const stream = createReadStream(filePath);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    }
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = createServer((request, response) => {
  if (isEnquiryRequest(request)) {
    void handleEnquiry(request, response);
    return;
  }
  if (vite) {
    vite.middlewares(request, response, () => {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    });
    return;
  }
  void serveProduction(request, response);
});

server.requestTimeout = 20_000;
server.headersTimeout = 25_000;

server.listen(port, host, () => {
  console.info(
    `Daley Dynamics ${production ? 'production' : 'development'} server: http://${host}:${server.address().port}`,
  );
});

async function shutdown() {
  server.close();
  await vite?.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
