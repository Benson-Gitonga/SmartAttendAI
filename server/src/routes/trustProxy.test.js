import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';
import { parseTrustProxy } from '../config.js';
import { createUser } from '../db/repository.js';
import { hashPassword } from '../auth/systemAdminAuth.js';
import { testUserAuth, testSystemAdminAuth } from '../auth/testing.js';

const PASSWORD = 'correct horse battery';
let db;
let server;

async function start(trustProxy) {
  db = openDatabase(':memory:');
  db.prepare(`INSERT INTO schools (school_id, name, county) VALUES ('school-1', 'School 1', 'Nairobi')`).run();
  createUser(db, { email: 'admin@school.ke', fullName: 'Admin', role: 'admin', schoolId: 'school-1', passwordHash: hashPassword(PASSWORD) });
  const userAuth = testUserAuth(db, { maxFailures: 3, lockoutMs: 60_000, tokenTtlMs: 60_000 });
  server = createApp({ db, logger: false, userAuth, systemAdminAuth: testSystemAdminAuth(), trustProxy }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (password, from) =>
    fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': from },
      body: JSON.stringify({ email: 'admin@school.ke', password }),
    });
}

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

test('behind a trusted proxy, one visitor locking themselves out does not lock out another', async () => {
  const login = await start(1);
  for (let i = 0; i < 3; i++) await login('wrong', '203.0.113.7');
  assert.equal((await login(PASSWORD, '203.0.113.7')).status, 429);
  assert.equal((await login(PASSWORD, '198.51.100.20')).status, 200);
});

test('without TRUST_PROXY, a forged X-Forwarded-For does not get round the lockout', async () => {
  const login = await start(false);
  for (let i = 0; i < 3; i++) await login('wrong', '203.0.113.7');
  assert.equal((await login(PASSWORD, '198.51.100.20')).status, 429);
});

test('TRUST_PROXY values', () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('0'), false);
  assert.equal(parseTrustProxy('2'), 2);
  assert.equal(parseTrustProxy(' loopback, 10.0.0.0/8 '), 'loopback, 10.0.0.0/8');
});
