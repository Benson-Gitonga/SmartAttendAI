// Every setting can be overridden by an environment variable.
import { resolve, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// OneDrive locks SQLite's WAL files, so the database lives outside the project
// by default. Override with DB_PATH.
const defaultDbDir =
  process.env.LOCALAPPDATA ||
  (process.platform === 'win32' ? join(homedir(), 'AppData', 'Local') : tmpdir());

export const config = {
  port: num(process.env.PORT, 3000),

  dbPath:
    process.env.DB_PATH === ':memory:'
      ? ':memory:'
      : process.env.DB_PATH
        ? resolve(process.env.DB_PATH)
        : join(defaultDbDir, 'smartattend', 'smartattend.db'),

  // The built PWA (client/dist) to serve next to /api, so one service hosts
  // everything (the Dockerfile at the project root sets it). Unset in
  // development, where Vite serves the app.
  clientDir: process.env.CLIENT_DIST ? resolve(process.env.CLIENT_DIST) : '',

  // Fill the Kibera demo school with three months of made-up attendance on
  // start (src/db/seedDemoData.js). Never queued for the cloud.
  demoData: process.env.DEMO_DATA !== 'false',

  // Mock RFID reader: emit a card-detected event this often.
  rfidIntervalMs: num(process.env.RFID_INTERVAL_MS, 5000),

  // Fraction of RFID scans that trigger a fingerprint challenge (0..1).
  fingerprintChallengeRate: num(process.env.FINGERPRINT_CHALLENGE_RATE, 0.25),

  // Fraction of fingerprint challenges the mock scanner reports as a match (0..1).
  fingerprintSuccessRate: num(process.env.FINGERPRINT_SUCCESS_RATE, 0.9),

  // Start the RFID simulation loop when the server boots.
  simulationEnabled: process.env.SIMULATION_ENABLED !== 'false',

  // Gate devices (hardware/wokwi-gate) send this in the X-Device-Key header.
  // Empty means POST /api/rfid/scan is open, as before.
  deviceApiKey: process.env.DEVICE_API_KEY || '',

  // How old an offline-queued gate scan may be when it finally arrives, and
  // how far ahead of the server clock a device clock may run.
  offlineScanMaxAgeDays: num(process.env.OFFLINE_SCAN_MAX_AGE_DAYS, 7),
  deviceClockSkewMs: num(process.env.DEVICE_CLOCK_SKEW_MS, 5 * 60_000),

  // School staff sign-in (src/auth/userAuth.js). Tokens are long-lived so a
  // teacher who works offline for days can still send their queued records.
  // Without a secret, a random one is made per boot and sign-ins end on restart.
  auth: {
    tokenSecret: process.env.AUTH_TOKEN_SECRET || '',
    tokenTtlMs: num(process.env.AUTH_TOKEN_TTL_DAYS, 30) * 24 * 60 * 60 * 1000,
  },

  // Outgoing email (src/mail/mailer.js). 'log' prints each email and keeps it
  // in the dev outbox; 'ses' sends it with Amazon SES; 'brevo' with Brevo.
  mail: {
    transport: ['ses', 'brevo'].includes(process.env.MAIL_TRANSPORT) ? process.env.MAIL_TRANSPORT : 'log',
    from: process.env.MAIL_FROM || 'SmartAttend <no-reply@smartattend.local>',
    region: process.env.AWS_REGION || process.env.SES_REGION || undefined,
    brevoApiKey: process.env.BREVO_API_KEY || '',
  },

  // Where the PWA lives, for the links in emails.
  appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, ''),

  // The one system admin account (src/auth/systemAdminAuth.js). Set with
  // `npm run sysadmin:set`; only a hash of the password is kept. With no username
  // or hash, the /api/system-admin endpoints answer 503.
  systemAdmin: {
    username: process.env.SYSTEM_ADMIN_USERNAME || '',
    passwordHash: process.env.SYSTEM_ADMIN_PASSWORD_HASH || '',
    tokenSecret: process.env.SYSTEM_ADMIN_TOKEN_SECRET || '',
    tokenTtlMs: num(process.env.SYSTEM_ADMIN_TOKEN_TTL_HOURS, 8) * 60 * 60 * 1000,
  },

  // Outbound cloud sync (src/workers/syncWorker.js).
  sync: {
    workerDisabled: process.env.SYNC_WORKER_DISABLED === 'true',
    apiUrl: process.env.SYNC_API_GATEWAY_URL || '',
    apiKey: process.env.SYNC_API_GATEWAY_KEY || '',
    pollIntervalMs: num(process.env.SYNC_POLL_INTERVAL_MS, 30_000),
    batchSize: num(process.env.SYNC_BATCH_SIZE, 50),
    backoffMinMs: num(process.env.SYNC_BACKOFF_MIN_MS, 60_000),
    backoffMaxMs: num(process.env.SYNC_BACKOFF_MAX_MS, 30 * 60_000),
    maxAttempts: num(process.env.SYNC_MAX_ATTEMPTS, 12),
    requestTimeoutMs: num(process.env.SYNC_REQUEST_TIMEOUT_MS, 15_000),
    deviceId: process.env.SYNC_DEVICE_ID || 'tier2-server',
  },
};
