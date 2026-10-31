import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';

const root = new URL('../', import.meta.url);
const children = [];
let origin;
let unavailableOrigin;
let smtp;

// Deliberately exclude inherited SMTP settings and secrets from these local checks.
function start(file, args, environment, ready) {
  const child = spawn(process.execPath, [file, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.output = '';
  child.stdout.on('data', (chunk) => (child.output += chunk.toString()));
  child.stderr.resume();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out starting ${file}`));
    }, 15_000);
    const finish = (error, result) => {
      clearTimeout(timer);
      child.stdout.off('data', check);
      child.off('error', failed);
      child.off('exit', exited);
      if (error) reject(error);
      else resolve({ child, value: result });
    };
    const check = () => {
      const match = child.output.match(ready);
      if (match) finish(null, match[1]);
    };
    const failed = (error) => finish(error);
    const exited = (code) => finish(new Error(`${file} exited before readiness (${code})`));
    child.stdout.on('data', check);
    child.once('error', failed);
    child.once('exit', exited);
  });
}

before(async () => {
  await readFile(new URL('../dist/index.html', import.meta.url));
  smtp = await start(
    'scripts/mock-smtp-sink.mjs',
    [],
    { MOCK_SMTP_PORT: '0' },
    /127\.0\.0\.1:(\d+)/,
  );
  const server = await start(
    'server/index.js',
    ['--production'],
    {
      HOST: '127.0.0.1',
      PORT: '0',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: smtp.value,
      SMTP_SECURE: 'false',
      ENQUIRY_TO_EMAIL: 'enquiries@example.invalid',
      ENQUIRY_FROM_EMAIL: 'website@example.invalid',
    },
    /(http:\/\/127\.0\.0\.1:\d+)/,
  );
  origin = server.value;
  const unavailable = await start(
    'server/index.js',
    ['--production'],
    { HOST: '127.0.0.1', PORT: '0' },
    /(http:\/\/127\.0\.0\.1:\d+)/,
  );
  unavailableOrigin = unavailable.value;
});

after(async () => {
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      child.kill('SIGTERM');
      await exited;
      clearTimeout(timer);
    }),
  );
});

const routes = [
  '/',
  '/about/',
  '/capabilities/',
  '/work/',
  '/start-a-project/',
  '/work/business-server-knowledge-system/',
  '/work/operational-analytics/',
];

test('all routes, local links, fragments and built resources resolve', async () => {
  const pages = new Map();
  const assets = new Set();
  for (const route of routes) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    const html = await response.text();
    pages.set(route, html);
    assert.match(html, /<html[^>]+lang="en"/);
    assert.equal([...html.matchAll(/<h1(?:\s|>)/g)].length, 1, route);
    assert.match(html, /href="#main-content"/);
  }
  for (const [route, html] of pages) {
    for (const [, value] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const url = new URL(value.replaceAll('&amp;', '&'), origin + route);
      if (url.origin !== origin) continue;
      if (url.pathname.endsWith('/')) {
        assert.ok(pages.has(url.pathname), `Unknown route: ${url.pathname}`);
        if (url.hash) {
          const id = decodeURIComponent(url.hash.slice(1));
          assert.ok(
            pages.get(url.pathname).includes(`id="${id}"`),
            `${route}: missing ${url.hash}`,
          );
        }
      } else assets.add(url.pathname);
    }
  }
  for (const asset of assets) {
    const response = await fetch(origin + asset);
    assert.equal(response.status, 200, asset);
    if (asset.endsWith('.css')) {
      const css = await response.text();
      for (const [, value] of css.matchAll(/url\(["']?([^\s"')]+)["']?\)/g)) {
        if (!value.startsWith('data:')) assets.add(new URL(value, origin + asset).pathname);
      }
    }
  }
});

test('only fingerprinted build assets receive immutable caching', async () => {
  const html = await (await fetch(origin)).text();
  const script = html.match(/<script[^>]+src="([^"]+)"/)[1];
  assert.match((await fetch(origin + script)).headers.get('cache-control'), /immutable/);
  for (const asset of [
    '/favicon.png',
    '/assets/nature-hero.jpg',
    '/assets/fern-frond.webp',
    '/assets/daley-dynamics-logo.png',
    '/licenses/Michroma-OFL.txt',
  ]) {
    const response = await fetch(origin + asset);
    assert.equal(response.status, 200, asset);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  }
});

test('HEAD, missing files, malformed URLs and unsupported methods have correct responses', async () => {
  const head = await fetch(origin, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.ok(Number(head.headers.get('content-length')) > 0);
  assert.equal((await fetch(origin + '/missing-page/')).status, 404);
  assert.equal((await fetch(origin + '/%zz')).status, 400);
  assert.equal((await fetch(origin + '/%2e%2e%2fpackage.json')).status, 403);
  assert.equal((await fetch(origin + '/.env.local')).status, 404);
  assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
});

function payload() {
  return {
    name: 'Taylor Example',
    company: 'Example Company',
    email: 'taylor@example.invalid',
    phone: '',
    help: [],
    problem: 'A recurring manual reporting process needs a more reliable workflow.',
    currentProcess: '',
    desiredResult: '',
    stage: 'exploring',
    website: '',
    formStartedAt: Date.now() - 5000,
  };
}

function submit(base, data, headers = {}) {
  return fetch(base + '/api/enquiries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, ...headers },
    body: JSON.stringify(data),
  });
}

test('a real HTTP enquiry reaches the local SMTP sink before success', async () => {
  const response = await submit(origin, payload());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.match(smtp.child.output, /accepted one enquiry message/);
});

test('the HTTP endpoint rejects invalid input and cross-origin requests', async () => {
  assert.equal((await submit(origin, { ...payload(), email: 'invalid' })).status, 422);
  assert.equal(
    (await submit(origin, payload(), { Origin: 'https://unrelated.example' })).status,
    403,
  );
  assert.equal((await fetch(origin + '/api/enquiries')).status, 405);
});

test('missing SMTP configuration returns a safe failure over HTTP', async () => {
  const response = await submit(unavailableOrigin, payload());
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, 'DELIVERY_UNAVAILABLE');
});
