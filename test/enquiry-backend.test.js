import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import { buildEnquiryEmail, readEmailConfiguration } from '../server/enquiry/email.js';
import { createEnquiryHandler } from '../server/enquiry/handler.js';
import { InMemoryRateLimiter } from '../server/enquiry/rate-limit.js';

const NOW = Date.parse('2026-09-22T00:00:00.000Z');
const quietLogger = { info() {}, warn() {}, error() {} };

function validPayload(overrides = {}) {
  return {
    name: 'Taylor Example',
    company: 'Example Company',
    email: 'Taylor@Example.com',
    phone: '',
    help: [],
    problem: 'A recurring manual reporting process needs a more reliable workflow.',
    currentProcess: '',
    desiredResult: '',
    stage: 'exploring',
    website: '',
    formStartedAt: NOW - 5_000,
    ...overrides,
  };
}

function createHarness({ sendEnquiry, limiter } = {}) {
  const sent = [];
  const handler = createEnquiryHandler({
    sendEnquiry:
      sendEnquiry ||
      (async (enquiry) => {
        sent.push(enquiry);
      }),
    limiter:
      limiter ||
      new InMemoryRateLimiter({ limit: 100, now: () => NOW, secret: Buffer.from('test-secret') }),
    environment: {},
    now: () => NOW,
    logger: quietLogger,
  });
  return { handler, sent };
}

async function request(handler, payload, options = {}) {
  const method = options.method || 'POST';
  const body =
    options.body !== undefined ? options.body : method === 'GET' ? '' : JSON.stringify(payload);
  const requestStream = Readable.from(body ? [Buffer.from(body)] : []);
  requestStream.method = method;
  requestStream.url = '/api/enquiries';
  requestStream.headers = {
    host: '127.0.0.1:5173',
    origin: options.origin || 'http://127.0.0.1:5173',
    'content-type': options.contentType || 'application/json',
    'content-length': String(Buffer.byteLength(body)),
    ...options.headers,
  };
  requestStream.socket = { remoteAddress: '127.0.0.1' };

  const responseHeaders = {};
  const response = {
    status: 0,
    body: '',
    writeHead(status, headers = {}) {
      this.status = status;
      for (const [name, value] of Object.entries(headers))
        responseHeaders[name.toLowerCase()] = String(value);
    },
    end(chunk = '') {
      this.body += chunk;
    },
  };
  await handler(requestStream, response);
  return {
    status: response.status,
    headers: { get: (name) => responseHeaders[name.toLowerCase()] || null },
    json: async () => JSON.parse(response.body),
  };
}

test('accepts a minimal valid enquiry and normalizes the email domain', async () => {
  const { handler, sent } = createHarness();
  const response = await request(handler, validPayload());
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, 'Taylor@example.com');
});

test('accepts a full enquiry with multiple allowed help categories', async () => {
  const { handler, sent } = createHarness();
  const response = await request(
    handler,
    validPayload({
      phone: '+64 21 555 0199',
      help: ['software', 'data', 'automation'],
      currentProcess: 'Exports are rebuilt manually and checked in separate spreadsheets.',
      desiredResult: 'One repeatable and reviewable workflow.',
      stage: 'identified',
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(sent[0].help, ['software', 'data', 'automation']);
});

for (const [name, change, field] of [
  ['missing name', { name: '' }, 'name'],
  ['invalid email', { email: 'not-an-email' }, 'email'],
  ['missing project description', { problem: '' }, 'problem'],
  ['oversized project description', { problem: 'x'.repeat(4001) }, 'problem'],
  ['unknown category', { help: ['unknown'] }, 'help'],
  ['unknown stage', { stage: 'finished' }, 'stage'],
]) {
  test(`rejects ${name} without sending email`, async () => {
    const { handler, sent } = createHarness();
    const response = await request(handler, validPayload(change));
    const result = await response.json();

    assert.equal(response.status, 422);
    assert.equal(result.code, 'VALIDATION_ERROR');
    assert.ok(result.fieldErrors[field]);
    assert.equal(sent.length, 0);
  });
}

test('rejects unexpected fields', async () => {
  const { handler, sent } = createHarness();
  const response = await request(handler, validPayload({ admin: true }));

  assert.equal(response.status, 422);
  assert.equal(sent.length, 0);
});

test('rejects malformed scalar fields and a non-string honeypot', async () => {
  const { handler, sent } = createHarness();
  assert.equal((await request(handler, validPayload({ phone: { value: '123' } }))).status, 422);
  assert.equal((await request(handler, validPayload({ website: {} }))).status, 422);
  assert.equal(sent.length, 0);
});

test('rejects email address lists before using Reply-To', async () => {
  const { handler, sent } = createHarness();
  const response = await request(
    handler,
    validPayload({ email: 'person@example.com,attacker@example.com' }),
  );
  assert.equal(response.status, 422);
  assert.ok((await response.json()).fieldErrors.email);
  assert.equal(sent.length, 0);
});

test('rejects malformed JSON', async () => {
  const { handler, sent } = createHarness();
  const response = await request(handler, null, { body: '{not-json' });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'MALFORMED_REQUEST');
  assert.equal(sent.length, 0);
});

test('rejects a request body over 16 KiB', async () => {
  const { handler, sent } = createHarness();
  const response = await request(handler, null, { body: 'x'.repeat(16 * 1024 + 1) });

  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, 'PAYLOAD_TOO_LARGE');
  assert.equal(sent.length, 0);
});

test('rejects a populated honeypot without sending email', async () => {
  const { handler, sent } = createHarness();
  const response = await request(handler, validPayload({ website: 'https://spam.invalid' }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'INVALID_SUBMISSION');
  assert.equal(sent.length, 0);
});

test('rejects an impossibly fast submission without sending email', async () => {
  const { handler, sent } = createHarness();
  const response = await request(handler, validPayload({ formStartedAt: NOW }));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'INVALID_SUBMISSION');
  assert.equal(sent.length, 0);
});

test('rate limits repeated requests before another email is sent', async () => {
  const limiter = new InMemoryRateLimiter({
    limit: 1,
    now: () => NOW,
    secret: Buffer.from('rate-test'),
  });
  const { handler, sent } = createHarness({ limiter });

  assert.equal((await request(handler, validPayload())).status, 200);
  const limited = await request(handler, validPayload());
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.equal(sent.length, 1);
});

test('returns a safe failure and no false success when mail delivery fails', async () => {
  const { handler } = createHarness({
    sendEnquiry: async () => {
      throw new Error('private SMTP detail');
    },
  });
  const response = await request(handler, validPayload());
  const result = await response.json();

  assert.equal(response.status, 503);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DELIVERY_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result), /SMTP|private/u);
});

test('accepts POST only', async () => {
  const { handler } = createHarness();
  const response = await request(handler, null, { method: 'GET' });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
});

test('requires JSON and a same-origin request', async () => {
  const { handler } = createHarness();
  const wrongType = await request(handler, validPayload(), {
    contentType: 'application/x-www-form-urlencoded',
    body: 'name=Taylor',
  });
  const wrongOrigin = await request(handler, validPayload(), {
    origin: 'https://untrusted.invalid',
  });

  assert.equal(wrongType.status, 415);
  assert.equal(wrongOrigin.status, 403);
});

test('rejects media types that only start with application/json', async () => {
  const { handler } = createHarness();
  const response = await request(handler, validPayload(), {
    contentType: 'application/json-bad',
  });
  assert.equal(response.status, 415);
});

test('plain-text email uses fixed headers and preserves user text as text', () => {
  const enquiry = validPayload({
    help: ['ai', 'infrastructure'],
    problem: 'Review the literal text <script>alert("no execution")</script> safely.',
  });
  delete enquiry.website;
  delete enquiry.formStartedAt;
  const email = buildEnquiryEmail(enquiry, {
    from: 'website@example.com',
    to: 'enquiries@example.com',
    timestamp: new Date(NOW),
  });

  assert.equal(email.replyTo, 'Taylor@Example.com');
  assert.equal(email.html, undefined);
  assert.match(email.text, /<script>alert\("no execution"\)<\/script>/u);
  assert.match(email.text, /AI \/ Knowledge System/u);
  assert.match(email.text, /2026-09-22T00:00:00.000Z/u);
});

test('header injection is rejected before email construction', async () => {
  const { handler, sent } = createHarness();
  const response = await request(
    handler,
    validPayload({ name: 'Taylor\r\nBcc: attacker@example.invalid' }),
  );

  assert.equal(response.status, 422);
  assert.equal(sent.length, 0);
});

test('missing SMTP configuration fails closed', () => {
  assert.throws(() => readEmailConfiguration({}), /SMTP_PORT is not configured/u);
});
