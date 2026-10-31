import { createHmac, randomBytes } from 'node:crypto';

import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from './constants.js';

export class InMemoryRateLimiter {
  constructor({
    limit = RATE_LIMIT_MAX_REQUESTS,
    windowMs = RATE_LIMIT_WINDOW_MS,
    now = Date.now,
    secret = randomBytes(32),
  } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.secret = secret;
    this.entries = new Map();
  }

  consume(identifier) {
    const timestamp = this.now();
    const key = createHmac('sha256', this.secret)
      .update(identifier || 'unknown')
      .digest('hex');
    const current = this.entries.get(key);

    if (!current || timestamp >= current.resetAt) {
      this.entries.set(key, { count: 1, resetAt: timestamp + this.windowMs });
      this.prune(timestamp);
      return { allowed: true, remaining: this.limit - 1 };
    }

    if (current.count >= this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - timestamp) / 1000)),
      };
    }

    current.count += 1;
    return { allowed: true, remaining: this.limit - current.count };
  }

  prune(timestamp) {
    if (this.entries.size < 500) return;
    for (const [key, entry] of this.entries) {
      if (timestamp >= entry.resetAt) this.entries.delete(key);
    }
  }
}

export function getRequestSource(request, trustProxy = false) {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  }
  return request.socket.remoteAddress || 'unknown';
}
