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

  // WAL needs shared memory, which network file shares (Azure App Service's
  // /home) don't support; set SQLITE_JOURNAL_MODE=DELETE there.
  sqliteJournalMode: (process.env.SQLITE_JOURNAL_MODE || 'WAL').toUpperCase(),

  // How long to keep retrying when the database cannot be opened at start-up.
  // On Azure the new copy of the app starts while the old one still has the
  // file open, so it can be locked for a moment.
  dbOpenRetryMs: num(process.env.DB_OPEN_RETRY_MS, 120_000),

  // A copy of the database is written here once a day (src/db/backup.js), and
  // the newest BACKUP_KEEP_DAYS copies are kept. Off for ':memory:'.
  backup: {
    dir: process.env.BACKUP_DIR ? resolve(process.env.BACKUP_DIR) : '',
    keepDays: num(process.env.BACKUP_KEEP_DAYS, 14),
    disabled: process.env.BACKUPS_DISABLED === 'true',
  },

  // The built PWA (client/dist) to serve next to /api, so one service hosts
  // everything (the Dockerfile at the project root sets it). Unset in
  // development, where Vite serves the app.
  clientDir: process.env.CLIENT_DIST ? resolve(process.env.CLIENT_DIST) : '',

  // Fill the Kibera demo school with three months of made-up attendance on
  // start (src/db/seedDemoData.js). Never queued for the cloud.
  demoData: process.env.DEMO_DATA !== 'false',

  // School staff sign-in (src/auth/userAuth.js). Tokens are long-lived so a
  // teacher who works offline for days can still send their queued records.
  // Without a secret, a random one is made per boot and sign-ins end on restart.
  auth: {
    tokenSecret: process.env.AUTH_TOKEN_SECRET || '',
    tokenTtlMs: num(process.env.AUTH_TOKEN_TTL_DAYS, 30) * 24 * 60 * 60 * 1000,
  },

  // "Continue with Google" (src/auth/googleAuth.js). The OAuth web client id
  // from Google Cloud; the PWA reads it from GET /api/auth/google. Without one,
  // a development-only stand-in is used unless NODE_ENV=production.
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    devMode: process.env.NODE_ENV !== 'production' && process.env.GOOGLE_SIGNIN !== 'off',
  },

  // Outgoing email (src/mail/mailer.js). 'log' prints each email and keeps it
  // in the dev outbox; 'ses' sends it with Amazon SES; 'brevo' with Brevo.
  mail: {
    transport: ['ses', 'brevo'].includes(process.env.MAIL_TRANSPORT) ? process.env.MAIL_TRANSPORT : 'log',
    from: process.env.MAIL_FROM || 'SmartAttend <no-reply@smartattend.local>',
    region: process.env.AWS_REGION || process.env.SES_REGION || undefined,
    brevoApiKey: process.env.BREVO_API_KEY || '',
  },

  // Where the PWA lives, for the links in emails. On Render, the service's own
  // address is used when APP_URL is not set.
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/+$/, ''),

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
