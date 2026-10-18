// CLI: set the system admin's sign-in in server/.env.
//   npm run sysadmin:set -- admin@example.com
// Asks for the password (typed twice, not shown), then writes
// SYSTEM_ADMIN_EMAIL, SYSTEM_ADMIN_PASSWORD_HASH and, the first time,
// SYSTEM_ADMIN_TOKEN_SECRET. Only the hash is written, never the password.
// For scripted setups, SYSTEM_ADMIN_PASSWORD in the environment skips the prompt.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword } from './systemAdminAuth.js';

const ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
const MIN_LENGTH = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Replace or append KEY=value lines, keeping everything else in the file. */
export function upsertEnv(text, values) {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  for (const [key, value] of Object.entries(values)) {
    const at = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (at >= 0) lines[at] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Read a line without echoing it. */
function askHidden(question) {
  return new Promise((resolvePromise, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error('no terminal to type the password into; set SYSTEM_ADMIN_PASSWORD instead'));
      return;
    }
    stdout.write(question);
    let typed = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        stdout.write('\n');
        resolvePromise(typed);
      } else if (ch === '\u0003') {
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        typed = typed.slice(0, -1);
      } else {
        typed += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) {
    console.error('Usage: npm run sysadmin:set -- admin@example.com');
    process.exit(1);
  }

  let password = process.env.SYSTEM_ADMIN_PASSWORD;
  if (!password) {
    password = await askHidden('New system admin password: ');
    const again = await askHidden('Type it again: ');
    if (password !== again) {
      console.error('The two passwords do not match. Nothing was changed.');
      process.exit(1);
    }
  }
  if (password.length < MIN_LENGTH) {
    console.error(`Use at least ${MIN_LENGTH} characters. Nothing was changed.`);
    process.exit(1);
  }

  const current = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const values = { SYSTEM_ADMIN_EMAIL: email, SYSTEM_ADMIN_PASSWORD_HASH: hashPassword(password) };
  if (!/^SYSTEM_ADMIN_TOKEN_SECRET=.+/m.test(current)) {
    values.SYSTEM_ADMIN_TOKEN_SECRET = randomBytes(32).toString('base64url');
  }
  writeFileSync(ENV_PATH, upsertEnv(current, values));

  console.log(`System admin set to ${email} in ${ENV_PATH}`);
  console.log('Restart the server for the change to take effect.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
