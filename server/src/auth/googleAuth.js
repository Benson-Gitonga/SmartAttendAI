/**
 * "Continue with Google" for school admins and teachers. The PWA gets an ID
 * token from Google Identity Services and sends it here; this checks Google's
 * signature and claims and returns the verified email. No Google library: the
 * token is an RS256 JWT, checked against Google's published keys with
 * node:crypto. Google sign-in never makes an account, it only signs in to one
 * the school admin (or the application form) already made.
 *
 * Three modes, from config.google:
 *   'google' GOOGLE_CLIENT_ID is set: real Google tokens only.
 *   'dev'    no client id and not production: the PWA sends "dev:<email>"
 *            instead, so the whole flow can be tried before a Google Cloud
 *            project exists. Like the mail outbox, it is for development only.
 *   'off'    neither: the button is hidden.
 */

import { createPublicKey, verify as verifySignature } from 'node:crypto';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_KEYS_TTL_MS = 60 * 60 * 1000;
export const DEV_PREFIX = 'dev:';

export class GoogleTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GoogleTokenError';
  }
}

const b64urlJson = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * @param {object} opts
 * @param {string} [opts.clientId]  the OAuth client id the token must be for
 * @param {boolean} [opts.devMode]  allow "dev:<email>" when there is no client id
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {() => number} [opts.now]
 */
export function createGoogleVerifier({ clientId = '', devMode = false, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const mode = clientId ? 'google' : devMode ? 'dev' : 'off';
  let keys = null; // { byKid: Map, expiresAt }

  async function loadKeys(force = false) {
    if (!force && keys && keys.expiresAt > now()) return keys.byKid;
    let res;
    try {
      res = await fetchImpl(CERTS_URL);
    } catch {
      throw new GoogleTokenError('could not reach Google to check the sign-in');
    }
    if (!res.ok) throw new GoogleTokenError(`Google keys answered ${res.status}`);
    const { keys: jwks = [] } = await res.json();
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers?.get?.('cache-control') ?? '')?.[1]);
    keys = {
      byKid: new Map(jwks.map((jwk) => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })])),
      expiresAt: now() + (Number.isFinite(maxAge) ? maxAge * 1000 : DEFAULT_KEYS_TTL_MS),
    };
    return keys.byKid;
  }

  async function verifyGoogleToken(idToken) {
    const parts = String(idToken).split('.');
    if (parts.length !== 3) throw new GoogleTokenError('not a Google ID token');
    let header;
    let claims;
    try {
      header = b64urlJson(parts[0]);
      claims = b64urlJson(parts[1]);
    } catch {
      throw new GoogleTokenError('not a Google ID token');
    }
    if (header.alg !== 'RS256') throw new GoogleTokenError('unexpected token algorithm');

    // Google rotates keys; an unknown kid means ours are stale, so fetch once more.
    let key = (await loadKeys()).get(header.kid);
    if (!key) key = (await loadKeys(true)).get(header.kid);
    if (!key) throw new GoogleTokenError('token signed with an unknown key');

    const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
    if (!verifySignature('RSA-SHA256', signed, key, Buffer.from(parts[2], 'base64url'))) {
      throw new GoogleTokenError('bad token signature');
    }
    if (!ISSUERS.has(claims.iss)) throw new GoogleTokenError('token not issued by Google');
    if (claims.aud !== clientId) throw new GoogleTokenError('token is for another app');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 + CLOCK_SKEW_MS < now()) {
      throw new GoogleTokenError('token has expired');
    }
    if (!claims.email) throw new GoogleTokenError('token has no email');

    return {
      email: String(claims.email).toLowerCase(),
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      name: claims.name ?? null,
      sub: claims.sub,
    };
  }

  /**
   * @returns {Promise<{email: string, emailVerified: boolean, name: string|null, sub: string}>}
   * @throws {GoogleTokenError}
   */
  async function verify(credential) {
    if (mode === 'off') throw new GoogleTokenError('Google sign-in is not set up on this server');
    if (mode === 'dev') {
      const email = String(credential ?? '').startsWith(DEV_PREFIX) ? String(credential).slice(DEV_PREFIX.length).trim() : '';
      if (!email.includes('@')) throw new GoogleTokenError('development mode expects dev:<email>');
      return { email: email.toLowerCase(), emailVerified: true, name: null, sub: `dev-${email.toLowerCase()}` };
    }
    return verifyGoogleToken(credential);
  }

  return { mode, clientId: mode === 'google' ? clientId : null, verify };
}
