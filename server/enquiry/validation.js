import { HELP_OPTIONS, MIN_FORM_TIME_MS, REQUEST_FIELDS, STAGE_OPTIONS } from './constants.js';

const emailPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u;
const lineBreakPattern = /[\r\n]/u;
const textFields = [
  'name',
  'company',
  'email',
  'phone',
  'problem',
  'currentProcess',
  'desiredResult',
  'stage',
  'website',
];

function hasUnsupportedControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  });
}

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function addTextError(errors, field, value, { label, required = false, min = 0, max, singleLine }) {
  if (!value) {
    if (required) errors[field] = `${label} is required.`;
    return;
  }
  if (value.length < min) errors[field] = `${label} must be at least ${min} characters.`;
  else if (value.length > max) errors[field] = `${label} must be ${max} characters or fewer.`;
  else if (hasUnsupportedControlCharacter(value) || (singleLine && lineBreakPattern.test(value)))
    errors[field] = `${label} contains unsupported characters.`;
}

function normalizeEmail(value) {
  const separator = value.lastIndexOf('@');
  if (separator < 1) return value;
  return `${value.slice(0, separator)}@${value.slice(separator + 1).toLowerCase()}`;
}

export function validateEnquiry(
  payload,
  { now = Date.now(), minimumFormTimeMs = MIN_FORM_TIME_MS } = {},
) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { errors: { form: 'The enquiry could not be read.' } };
  }

  const unexpectedFields = Object.keys(payload).filter((field) => !REQUEST_FIELDS.includes(field));
  if (unexpectedFields.length) {
    return { errors: { form: 'The enquiry contains unsupported fields.' } };
  }

  if (
    textFields.some((field) => payload[field] !== undefined && typeof payload[field] !== 'string')
  ) {
    return { errors: { form: 'The enquiry contains an invalid value.' } };
  }

  const website = trimmedString(payload.website);
  if (website) return { spam: true, reason: 'honeypot' };

  const formStartedAt = Number(payload.formStartedAt);
  if (
    !Number.isFinite(formStartedAt) ||
    formStartedAt <= 0 ||
    formStartedAt > now + 5 * 60 * 1000
  ) {
    return { errors: { form: 'Please reload the page and try again.' } };
  }
  if (now - formStartedAt < minimumFormTimeMs) return { spam: true, reason: 'timing' };

  const data = {
    name: trimmedString(payload.name),
    company: trimmedString(payload.company),
    email: normalizeEmail(trimmedString(payload.email)),
    phone: trimmedString(payload.phone),
    help: Array.isArray(payload.help) ? payload.help.map(trimmedString) : [],
    problem: trimmedString(payload.problem),
    currentProcess: trimmedString(payload.currentProcess),
    desiredResult: trimmedString(payload.desiredResult),
    stage: trimmedString(payload.stage),
  };
  const errors = {};

  addTextError(errors, 'name', data.name, {
    label: 'Name',
    required: true,
    min: 2,
    max: 100,
    singleLine: true,
  });
  addTextError(errors, 'company', data.company, {
    label: 'Company / Organisation',
    required: true,
    min: 2,
    max: 120,
    singleLine: true,
  });
  addTextError(errors, 'email', data.email, {
    label: 'Email',
    required: true,
    min: 5,
    max: 254,
    singleLine: true,
  });
  if (!errors.email && !emailPattern.test(data.email))
    errors.email = 'Enter a valid email address.';
  addTextError(errors, 'phone', data.phone, {
    label: 'Phone',
    max: 40,
    singleLine: true,
  });
  addTextError(errors, 'problem', data.problem, {
    label: 'Project description',
    required: true,
    min: 20,
    max: 4000,
  });
  addTextError(errors, 'currentProcess', data.currentProcess, {
    label: 'Current process',
    max: 3000,
  });
  addTextError(errors, 'desiredResult', data.desiredResult, {
    label: 'Desired result',
    max: 3000,
  });

  if (!Array.isArray(payload.help)) errors.help = 'Type of help must be a list.';
  else if (data.help.length > 5) errors.help = 'Choose no more than five types of help.';
  else if (data.help.some((value) => !Object.hasOwn(HELP_OPTIONS, value)))
    errors.help = 'Choose only the available types of help.';
  else if (new Set(data.help).size !== data.help.length)
    errors.help = 'Each type of help may only be selected once.';

  if (!Object.hasOwn(STAGE_OPTIONS, data.stage))
    errors.stage = 'Choose one of the available project stages.';

  return Object.keys(errors).length ? { errors } : { data };
}

export function isValidMailbox(value) {
  return (
    typeof value === 'string' &&
    value.length <= 254 &&
    emailPattern.test(value) &&
    !lineBreakPattern.test(value)
  );
}
