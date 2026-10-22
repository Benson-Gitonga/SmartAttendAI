import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMailer, parseAddress } from './mailer.js';

const message = { to: 'head@school.ac.ke', subject: 'Confirm your email', text: 'Open the link', html: '<p>Open the link</p>' };

describe('parseAddress', () => {
  test('splits a name and an address', () => {
    assert.deepEqual(parseAddress('SmartAttend <hello@example.com>'), { name: 'SmartAttend', email: 'hello@example.com' });
    assert.deepEqual(parseAddress('"Smart Attend" <hello@example.com>'), { name: 'Smart Attend', email: 'hello@example.com' });
    assert.deepEqual(parseAddress('hello@example.com'), { email: 'hello@example.com' });
  });
});

describe('Brevo transport', () => {
  test('posts the email to Brevo with the API key', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      return new Response(JSON.stringify({ messageId: 'abc' }), { status: 201 });
    };
    const mailer = createMailer({ transport: 'brevo', from: 'SmartAttend <hello@example.com>', brevoApiKey: 'key-1', fetchImpl });

    assert.deepEqual(await mailer.send(message), { sent: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(calls[0].opts.headers['api-key'], 'key-1');
    assert.deepEqual(JSON.parse(calls[0].opts.body), {
      sender: { name: 'SmartAttend', email: 'hello@example.com' },
      to: [{ email: 'head@school.ac.ke' }],
      subject: 'Confirm your email',
      textContent: 'Open the link',
      htmlContent: '<p>Open the link</p>',
    });
    assert.equal(mailer.outbox().length, 0, 'real email is not kept in the dev outbox');
  });

  test('a refused email is reported, not thrown', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ message: 'sender not valid' }), { status: 400 });
    const mailer = createMailer({ transport: 'brevo', brevoApiKey: 'key-1', fetchImpl });
    const errors = [];
    const original = console.error;
    console.error = (line) => errors.push(line);
    try {
      assert.deepEqual(await mailer.send(message), { sent: false, error: 'Brevo answered 400: sender not valid' });
    } finally {
      console.error = original;
    }
    assert.equal(errors.length, 1);
  });

  test('without an API key nothing is sent', async () => {
    let called = false;
    const mailer = createMailer({ transport: 'brevo', fetchImpl: async () => { called = true; } });
    const original = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await mailer.send(message), { sent: false, error: 'BREVO_API_KEY is not set' });
    } finally {
      console.error = original;
    }
    assert.equal(called, false);
  });
});
