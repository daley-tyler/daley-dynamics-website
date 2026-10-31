import nodemailer from 'nodemailer';

import { HELP_OPTIONS, STAGE_OPTIONS } from './constants.js';
import { isValidMailbox } from './validation.js';

export class EmailConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EmailConfigurationError';
  }
}

function required(value, name) {
  if (!value) throw new EmailConfigurationError(`${name} is not configured.`);
  return value;
}

function parseBoolean(value, name) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new EmailConfigurationError(`${name} must be true or false.`);
}

export function readEmailConfiguration(environment = process.env) {
  const port = Number(required(environment.SMTP_PORT, 'SMTP_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new EmailConfigurationError('SMTP_PORT is invalid.');

  const to = required(environment.ENQUIRY_TO_EMAIL, 'ENQUIRY_TO_EMAIL');
  const from = required(environment.ENQUIRY_FROM_EMAIL, 'ENQUIRY_FROM_EMAIL');
  if (!isValidMailbox(to) || !isValidMailbox(from))
    throw new EmailConfigurationError('Configured enquiry mailbox is invalid.');

  const user = environment.SMTP_USER || '';
  const pass = environment.SMTP_PASS || '';
  if (Boolean(user) !== Boolean(pass))
    throw new EmailConfigurationError('SMTP_USER and SMTP_PASS must be configured together.');

  return {
    host: required(environment.SMTP_HOST, 'SMTP_HOST'),
    port,
    secure: parseBoolean(required(environment.SMTP_SECURE, 'SMTP_SECURE'), 'SMTP_SECURE'),
    user,
    pass,
    to,
    from,
  };
}

export function buildEnquiryEmail(enquiry, { from, to, timestamp = new Date() }) {
  const help = enquiry.help.length
    ? enquiry.help.map((value) => `- ${HELP_OPTIONS[value]}`).join('\n')
    : '- No category selected';
  const optional = (value) => value || 'Not provided';

  return {
    from,
    to,
    replyTo: enquiry.email,
    subject: `Daley Dynamics project enquiry — ${enquiry.name} / ${enquiry.company}`,
    text: [
      'CONTACT',
      `Name: ${enquiry.name}`,
      `Company / Organisation: ${enquiry.company}`,
      `Email: ${enquiry.email}`,
      `Phone: ${optional(enquiry.phone)}`,
      '',
      'TYPE OF HELP',
      help,
      '',
      'PROJECT',
      enquiry.problem,
      '',
      'HOW IT WORKS TODAY',
      optional(enquiry.currentProcess),
      '',
      'DESIRED RESULT',
      optional(enquiry.desiredResult),
      '',
      'PROJECT STAGE',
      STAGE_OPTIONS[enquiry.stage],
      '',
      'SYSTEM METADATA',
      `Submitted: ${timestamp.toISOString()}`,
    ].join('\n'),
  };
}

export function createEmailSender(environment = process.env) {
  let transport;
  let configuration;

  return async function sendEnquiry(enquiry) {
    configuration ??= readEmailConfiguration(environment);
    transport ??= nodemailer.createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: configuration.secure,
      auth: configuration.user ? { user: configuration.user, pass: configuration.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    const result = await transport.sendMail(buildEnquiryEmail(enquiry, configuration));
    if (
      !result.accepted?.some((address) => address.toLowerCase() === configuration.to.toLowerCase())
    ) {
      throw new Error('The enquiry recipient was not accepted by the mail transport.');
    }
    return result;
  };
}
