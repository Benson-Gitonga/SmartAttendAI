/**
 * Outgoing email: account links (confirm email, set up, reset password) and
 * the school's review decision.
 *
 *   MAIL_TRANSPORT=log  (default) nothing is sent. Each email is printed to the
 *                       console and kept in a small outbox, which the dev-only
 *                       GET /api/dev/outbox lists so the links can be clicked.
 *   MAIL_TRANSPORT=ses  sent with Amazon SES (v2 API). Needs MAIL_FROM (a
 *                       verified sender) and AWS credentials in the environment
 *                       (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION).
 *
 * send() never throws: a failed email is logged and reported as { sent: false },
 * so a sign-up or an approval still goes through and the link can be resent.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const OUTBOX_SIZE = 50;

/**
 * @param {object} opts
 * @param {'log'|'ses'} [opts.transport]
 * @param {string} [opts.from]     e.g. "SmartAttend <no-reply@example.com>"
 * @param {string} [opts.region]   SES region
 * @param {boolean} [opts.quiet]   log transport: do not print (tests)
 * @param {string} [opts.outboxFile] log transport: keep the outbox in this JSON file, so a
 *                                  server restart (node --watch) does not lose the links
 * @param {(msg: object) => Promise<void>} [opts.sendImpl] replaces the transport (tests)
 */
export function createMailer({ transport = 'log', from = 'SmartAttend <no-reply@smartattend.local>', region, quiet = false, outboxFile = null, sendImpl } = {}) {
  const outbox = [];
  if (outboxFile) {
    try { outbox.push(...JSON.parse(readFileSync(outboxFile, 'utf8')).slice(0, OUTBOX_SIZE)); } catch { /* no outbox yet */ }
  }
  let sesClient = null;

  async function sendWithSes({ to, subject, text, html }) {
    const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
    sesClient ??= new SESv2Client(region ? { region } : {});
    await sesClient.send(new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: text, Charset: 'UTF-8' },
            ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}),
          },
        },
      },
    }));
  }

  function keep(message) {
    outbox.unshift({ ...message, at: new Date().toISOString() });
    outbox.length = Math.min(outbox.length, OUTBOX_SIZE);
    if (outboxFile) {
      try { writeFileSync(outboxFile, JSON.stringify(outbox)); } catch (err) { console.error(`[mail] could not save the outbox: ${err.message}`); }
    }
  }

  /** @param {{to: string, subject: string, text: string, html?: string, link?: string}} message */
  async function send(message) {
    try {
      if (sendImpl) await sendImpl(message);
      else if (transport === 'ses') await sendWithSes(message);
      else if (!quiet) {
        console.log(`[mail] to ${message.to}: ${message.subject}${message.link ? `\n[mail]   ${message.link}` : ''}`);
      }
      if (transport !== 'ses') keep(message);
      return { sent: true };
    } catch (err) {
      console.error(`[mail] could not send "${message.subject}" to ${message.to}: ${err.message}`);
      return { sent: false, error: err.message };
    }
  }

  return {
    transport,
    send,
    /** Most recent first. Only filled by the log transport. */
    outbox: () => outbox.slice(),
  };
}
