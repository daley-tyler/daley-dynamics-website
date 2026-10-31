export const ENQUIRY_ENDPOINT = '/api/enquiries';
export const MAX_BODY_BYTES = 16 * 1024;
export const MIN_FORM_TIME_MS = 1000;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const RATE_LIMIT_MAX_REQUESTS = 5;

export const HELP_OPTIONS = Object.freeze({
  software: 'Software / Internal Tool',
  automation: 'Automation',
  data: 'Data / Reporting / Analytics',
  ai: 'AI / Knowledge System',
  infrastructure: 'Server / Storage / Infrastructure',
  improvement: 'Existing System Improvement',
  unsure: 'Not Sure Yet',
});

export const STAGE_OPTIONS = Object.freeze({
  exploring: 'Just exploring',
  identified: 'I know what needs improving',
  existing: 'We already have a system that needs work',
  ready: 'Ready to start',
});

export const REQUEST_FIELDS = Object.freeze([
  'name',
  'company',
  'email',
  'phone',
  'help',
  'problem',
  'currentProcess',
  'desiredResult',
  'stage',
  'website',
  'formStartedAt',
]);
