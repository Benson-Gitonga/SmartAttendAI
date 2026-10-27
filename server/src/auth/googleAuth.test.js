import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createGoogleVerifier, GoogleTokenError } from './googleAuth.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const NOW = Date.UTC(2026, 9, 21, 8, 0, 0);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' };

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function makeToken(claims = {}, { kid = 'key-1', key = privateKey } = {}) {
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1234567890',
    email: 'Otieno@Kibera.ac.ke',
    email_verified: true,
    name: 'Ms. Otieno',
    exp: Math.floor(NOW / 1000) + 3600,
    ...claims,
  });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}

function keysFetch(keys = [jwk]) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, headers: new Headers({ 'cache-control': 'public, max-age=600' }), json: async () => ({ keys }) };
  };
  return { fetchImpl, calls };
}

const verifier = (fetchImpl) => createGoogleVerifier({ clientId: CLIENT_ID, fetchImpl, now: () => NOW });

describe('Google ID tokens', () => {
  test('a good token gives the email, lower-cased', async () => {
    const { fetchImpl } = keysFetch();
    const profile = await verifier(fetchImpl).verify(makeToken());
    assert.deepEqual(profile, { email: 'otieno@kibera.ac.ke', emailVerified: true, name: 'Ms. Otieno', sub: '1234567890' });
  });

  test("Google's keys are fetched once and reused", async () => {
    const { fetchImpl, calls } = keysFetch();
    const v = verifier(fetchImpl);
    await v.verify(makeToken());
    await v.verify(makeToken());
    assert.equal(calls.length, 1);
  });

  test('refused: another app, expired, wrong issuer, forged, unknown key', async () => {
    const { fetchImpl } = keysFetch();
    const v = verifier(fetchImpl);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    for (const token of [
      makeToken({ aud: 'someone-else' }),
      makeToken({ exp: Math.floor(NOW / 1000) - 3600 }),
      makeToken({ iss: 'https://evil.example' }),
      makeToken({}, { key: other }),
      makeToken({}, { kid: 'key-2' }),
      'not-a-token',
    ]) {
      await assert.rejects(v.verify(token), GoogleTokenError);
    }
  });
});

describe('modes', () => {
  test('no client id in development: "dev:<email>" stands in for Google', async () => {
    const v = createGoogleVerifier({ devMode: true });
    assert.equal(v.mode, 'dev');
    assert.equal(v.clientId, null);
    assert.equal((await v.verify('dev:Teacher@Kibera.ac.ke')).email, 'teacher@kibera.ac.ke');
    await assert.rejects(v.verify('teacher@kibera.ac.ke'), GoogleTokenError);
  });

  test('a real client id never accepts the dev stand-in', async () => {
    const { fetchImpl } = keysFetch();
    await assert.rejects(verifier(fetchImpl).verify('dev:teacher@kibera.ac.ke'), GoogleTokenError);
  });

  test('off when there is neither', async () => {
    const v = createGoogleVerifier({});
    assert.equal(v.mode, 'off');
    await assert.rejects(v.verify('dev:a@b.ke'), GoogleTokenError);
  });
});
