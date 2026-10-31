import { ENQUIRY_ENDPOINT, MAX_BODY_BYTES } from './constants.js';
import { EmailConfigurationError } from './email.js';
import { getRequestSource } from './rate-limit.js';
import { validateEnquiry } from './validation.js';

class RequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request, maximumBytes = MAX_BODY_BYTES) {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes)
    throw new RequestError(413, 'PAYLOAD_TOO_LARGE', 'The enquiry is too large to send.');

  let bytes = 0;
  let exceeded = false;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximumBytes) {
      exceeded = true;
      chunks.length = 0;
      continue;
    }
    if (!exceeded) chunks.push(chunk);
  }
  if (exceeded)
    throw new RequestError(413, 'PAYLOAD_TOO_LARGE', 'The enquiry is too large to send.');

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'MALFORMED_REQUEST', 'The enquiry could not be read.');
  }
}

function requestOrigin(request, trustProxy) {
  const host = request.headers.host;
  if (!host) return '';
  const forwardedProtocol = trustProxy ? request.headers['x-forwarded-proto'] : undefined;
  const protocol =
    typeof forwardedProtocol === 'string'
      ? forwardedProtocol.split(',')[0].trim()
      : request.socket.encrypted
        ? 'https'
        : 'http';
  return `${protocol}://${host}`;
}

function hasAllowedOrigin(request, environment) {
  const origin = request.headers.origin;
  if (!origin) return false;
  const configured = (environment.ENQUIRY_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowed = configured.length
    ? configured
    : [requestOrigin(request, environment.TRUST_PROXY === 'true')];
  return allowed.includes(origin);
}

export function createEnquiryHandler({
  sendEnquiry,
  limiter,
  environment = process.env,
  now = Date.now,
  logger = console,
} = {}) {
  if (typeof sendEnquiry !== 'function') throw new TypeError('sendEnquiry must be provided.');
  if (!limiter?.consume) throw new TypeError('A rate limiter must be provided.');

  return async function handleEnquiry(request, response) {
    if (request.method !== 'POST') {
      sendJson(
        response,
        405,
        { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Use POST for project enquiries.' },
        { Allow: 'POST' },
      );
      return;
    }

    const mediaType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
    if (mediaType !== 'application/json') {
      sendJson(response, 415, {
        ok: false,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Project enquiries must be sent as JSON.',
      });
      return;
    }

    if (!hasAllowedOrigin(request, environment)) {
      logger.warn?.({ event: 'enquiry_submission', status: 'rejected', category: 'origin' });
      sendJson(response, 403, {
        ok: false,
        code: 'ORIGIN_REJECTED',
        message: 'This enquiry could not be accepted from its current origin.',
      });
      return;
    }

    const rate = limiter.consume(getRequestSource(request, environment.TRUST_PROXY === 'true'));
    if (!rate.allowed) {
      logger.warn?.({ event: 'enquiry_submission', status: 'rejected', category: 'rate_limit' });
      sendJson(
        response,
        429,
        {
          ok: false,
          code: 'RATE_LIMITED',
          message: 'Too many enquiries were attempted. Please wait and try again.',
        },
        { 'Retry-After': String(rate.retryAfterSeconds) },
      );
      return;
    }

    try {
      const payload = await readJsonBody(request);
      const validation = validateEnquiry(payload, { now: now() });
      if (validation.spam) {
        logger.warn?.({ event: 'enquiry_submission', status: 'rejected', category: 'spam' });
        sendJson(response, 400, {
          ok: false,
          code: 'INVALID_SUBMISSION',
          message: 'The enquiry could not be sent. Please review the form and try again.',
        });
        return;
      }
      if (validation.errors) {
        logger.info?.({ event: 'enquiry_submission', status: 'rejected', category: 'validation' });
        sendJson(response, 422, {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'Please review the highlighted fields and try again.',
          fieldErrors: validation.errors,
        });
        return;
      }

      await sendEnquiry(validation.data);
      logger.info?.({ event: 'enquiry_submission', status: 'sent' });
      sendJson(response, 200, {
        ok: true,
        message: 'Thanks — your enquiry has been sent.',
      });
    } catch (error) {
      if (error instanceof RequestError) {
        logger.info?.({
          event: 'enquiry_submission',
          status: 'rejected',
          category: error.code.toLowerCase(),
        });
        sendJson(response, error.status, { ok: false, code: error.code, message: error.message });
        return;
      }

      logger.error?.({
        event: 'enquiry_submission',
        status: 'failed',
        category: error instanceof EmailConfigurationError ? 'configuration' : 'transport',
      });
      sendJson(response, 503, {
        ok: false,
        code: 'DELIVERY_UNAVAILABLE',
        message: 'Your enquiry could not be sent right now. Please try again.',
      });
    }
  };
}

export function isEnquiryRequest(request) {
  try {
    return new URL(request.url, 'http://local').pathname === ENQUIRY_ENDPOINT;
  } catch {
    return false;
  }
}
