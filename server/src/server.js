import { Worker } from 'node:worker_threads';
import { config } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { seed } from './db/seed.js';
import { seedDemoData } from './db/seedDemoData.js';
import { createApp } from './app.js';
import { createCardHandler, describeOutcome } from './attendance/handler.js';
import { RfidEmitter } from './simulation/rfidEmitter.js';
import { createMailer } from './mail/mailer.js';
import { dirname, join } from 'node:path';

const db = getDb();
seed(db);
const demo = config.demoData ? seedDemoData(db) : null;

const cardHandler = createCardHandler({ db });
// Without SES, the dev outbox is kept next to the database so a restart does
// not lose the links in it.
const mailer = createMailer({
  ...config.mail,
  outboxFile: config.dbPath === ':memory:' ? null : join(dirname(config.dbPath), 'mail-outbox.json'),
});
const app = createApp({ db, cardHandler, mailer });

const server = app.listen(config.port, () => {
  console.log(`SmartAttend server listening on http://localhost:${config.port}`);
  console.log(`  DB: ${config.dbPath}`);
  console.log(`  Email: ${config.mail.transport === 'ses' ? `Amazon SES from ${config.mail.from}` : 'not sent, printed here and listed at /#/dev/outbox'}`);
  console.log(`  Demo data: ${demo ? `on, ${demo.schoolDays} school days back (${demo.records} new records)` : 'off (DEMO_DATA=false)'}`);
  console.log(`  Cloud sync: ${config.sync.apiUrl && !config.sync.workerDisabled ? config.sync.apiUrl : 'off, no SYNC_API_GATEWAY_URL (records wait in sync_queue)'}`);
  console.log(`  Gate device key: ${config.deviceApiKey ? 'required (DEVICE_API_KEY)' : 'off, /api/rfid/scan is open'}`);
  console.log(`  Staff sign-in: ${config.auth.tokenSecret ? 'on' : 'on (no AUTH_TOKEN_SECRET, sign-ins end on restart)'}`);
  console.log(`  System admin: ${
    config.systemAdmin.username && config.systemAdmin.passwordHash
      ? `${config.systemAdmin.username}${config.systemAdmin.tokenSecret ? '' : ' (no SYSTEM_ADMIN_TOKEN_SECRET, sign-ins end on restart)'}`
      : 'not set up, run npm run sysadmin:set -- sysadmin'
  }`);
});

// The sync worker runs in its own thread so a slow AWS call cannot block the server.
// Without SYNC_API_GATEWAY_URL (no AWS yet) it is not started: records wait in
// sync_queue as 'pending' and all go up once the URL is set.
let syncWorker = null;
if (!config.sync.workerDisabled && config.sync.apiUrl) {
  syncWorker = new Worker(new URL('./workers/syncWorker.js', import.meta.url), {
    workerData: { env: process.env },
  });
  syncWorker.on('message', (m) => console.log('[syncWorker]', m));
  syncWorker.on('error', (e) => console.error('[syncWorker] crashed', e));
  syncWorker.on('exit', (code) => {
    if (code !== 0) console.error(`[syncWorker] exited with code ${code}`);
  });
}

const reader = new RfidEmitter();

reader.on('card-detected', (scan) => {
  try {
    const result = cardHandler(scan);
    logOutcome(scan, result);
  } catch (err) {
    console.error(`[rfid] handler crashed on ${scan.cardUid}:`, err.message);
  }
});

if (config.simulationEnabled) {
  reader.start();
  console.log(
    `RFID simulation on: a scan every ${config.rfidIntervalMs / 1000}s, ` +
      `${Math.round(config.fingerprintChallengeRate * 100)}% fingerprint challenge, ` +
      `${Math.round(config.fingerprintSuccessRate * 100)}% success rate`
  );
} else {
  console.log('RFID simulation off (SIMULATION_ENABLED=false). POST /api/rfid/scan to test manually.');
}

function logOutcome(scan, result) {
  console.log(`[rfid] ${describeOutcome(scan, result)}`);
}

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down`);
  reader.stop();
  server.close(async () => {
    if (syncWorker) await syncWorker.terminate();
    closeDb();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
