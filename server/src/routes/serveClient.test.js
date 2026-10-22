import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../db/index.js';
import { createApp } from '../app.js';

// One deployed service hosts the built PWA next to /api (see the root Dockerfile).
describe('serving the built app', () => {
  let dir;
  let server;
  let base;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'smartattend-client-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>SmartAttend</title>');
    writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
    writeFileSync(join(dir, 'sw.js'), 'self.skipWaiting()');
    server = createApp({ db: openDatabase(':memory:'), logger: false, clientDir: dir }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('serves index.html at / and for the app\'s own pages', async () => {
    for (const path of ['/', '/register', '/join/ABC123']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, path);
      assert.match(await res.text(), /SmartAttend/);
      assert.equal(res.headers.get('cache-control'), 'no-cache');
    }
  });

  test('caches hashed assets for a year, but not the service worker', async () => {
    const asset = await fetch(`${base}/assets/index-abc123.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control'), /immutable/);

    const sw = await fetch(`${base}/sw.js`);
    assert.equal(sw.status, 200);
    assert.equal(sw.headers.get('cache-control'), 'no-cache');
  });

  test('an unknown /api path is still a JSON 404, and /health still works', async () => {
    const res = await fetch(`${base}/api/nope`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not found' });
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
});
