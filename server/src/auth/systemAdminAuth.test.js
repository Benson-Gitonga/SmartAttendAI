import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, createSystemAdminAuth } from './systemAdminAuth.js';
import { upsertEnv } from './setSystemAdmin.js';

describe('password hashing', () => {
  const stored = hashPassword('Kibera-2026!');

  test('verifies the right password and refuses others', () => {
    assert.equal(verifyPassword('Kibera-2026!', stored), true);
    assert.equal(verifyPassword('kibera-2026!', stored), false);
    assert.equal(verifyPassword('', stored), false);
  });

  test('salts every hash, so the same password hashes differently', () => {
    assert.notEqual(hashPassword('Kibera-2026!'), stored);
  });

  test('never contains the password, and has no $ for .env files to mangle', () => {
    assert.doesNotMatch(stored, /Kibera/);
    assert.doesNotMatch(stored, /\$/);
    assert.match(stored, /^scrypt:16384:8:1:[\w-]+:[\w-]+$/);
  });

  test('a malformed stored hash just fails', () => {
    assert.equal(verifyPassword('x', 'not-a-hash'), false);
    assert.equal(verifyPassword('x', 'scrypt:1:1:1:a:b'), false);
  });
});

describe('tokens', () => {
  const auth = createSystemAdminAuth({ username: 'ops', passwordHash: hashPassword('pw'), tokenSecret: 's' });

  test('a tampered token is refused', () => {
    const { token } = auth.signIn('ops', 'pw');
    assert.ok(auth.verifyToken(token));
    const [body, mac] = token.split('.');
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    const longer = Buffer.from(JSON.stringify({ ...claims, exp: claims.exp + 1e9 })).toString('base64url');
    assert.equal(auth.verifyToken(`${longer}.${mac}`), null);
    assert.equal(auth.verifyToken(`${body}.${mac}.x`), null);
  });

  test('a token for another account is refused after the username changes', () => {
    const { token } = auth.signIn('ops', 'pw');
    const renamed = createSystemAdminAuth({ username: 'someone-new', passwordHash: hashPassword('pw'), tokenSecret: 's' });
    assert.equal(renamed.verifyToken(token), null);
  });
});

describe('upsertEnv', () => {
  test('replaces existing keys and keeps the rest of the file', () => {
    const out = upsertEnv('PORT=3000\nSYSTEM_ADMIN_EMAIL=old@x.ke\n', { SYSTEM_ADMIN_EMAIL: 'new@x.ke', SYSTEM_ADMIN_PASSWORD_HASH: 'h' });
    assert.equal(out, 'PORT=3000\nSYSTEM_ADMIN_EMAIL=new@x.ke\nSYSTEM_ADMIN_PASSWORD_HASH=h\n');
  });

  test('works on an empty or Windows-style file', () => {
    assert.equal(upsertEnv('', { A: '1' }), 'A=1\n');
    assert.equal(upsertEnv('PORT=3000\r\n', { A: '1' }), 'PORT=3000\nA=1\n');
  });
});
