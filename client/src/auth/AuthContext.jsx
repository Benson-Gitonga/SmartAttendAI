import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  signIn as serverSignIn,
  signInWithGoogle as serverGoogleSignIn,
  setUpWithGoogle as serverGoogleSetUp,
  registerSchool as serverRegisterSchool,
  redeemSetupCode,
  setPasswordWithLink,
  signOut as clearSession,
  loadStoredSession,
  isSessionValid,
  refreshSession,
  saveSystemAdminSession,
  updateStoredSchool,
} from './session';
import { loginSystemAdmin } from '../services/systemAdminService';
import { verifyPin, setPin, getPinStatus, clearLockout } from './pin';
import { watchInactivity, idleTooLong, markActive } from './inactivity';

const AuthContext = createContext(null);

// School staff sign in with an email; the system admin's name has no @.
const isSystemAdminName = (username) => Boolean(username?.trim()) && !username.includes('@');

/**
 *   signedOut: no session on the device, or it ran out.
 *   locked:    30 minutes without use; the offline PIN opens it again.
 *   ready:     signed in. Stays so offline, for as long as the server's sign-in lasts.
 */
export const AUTH_STATUS = { LOADING: 'loading', SIGNED_OUT: 'signedOut', LOCKED: 'locked', READY: 'ready' };

const NO_PIN = { enrolled: false, locked: false, attemptsRemaining: 3 };

// School staff lock after inactivity once they have a PIN to unlock with. The
// system admin's sign-in is short anyway and has no PIN.
const locksWhenIdle = (session, pinState) => session?.mode === 'server' && pinState.enrolled;

export function AuthProvider({ children }) {
  const [status, setStatus] = useState(AUTH_STATUS.LOADING);
  const [session, setSession] = useState(null);
  const [pinState, setPinState] = useState(NO_PIN);

  const refreshPinState = useCallback(async (username) => {
    const next = username ? await getPinStatus(username) : NO_PIN;
    setPinState(next);
    return next;
  }, []);

  /** @param {{fresh?: boolean}} opts fresh: a sign-in just happened, so do not lock */
  const applySession = useCallback(async (next, { fresh = false } = {}) => {
    if (next && !isSessionValid(next)) {
      await clearSession();
      next = null;
    }
    setSession(next);
    if (!next) {
      setPinState(NO_PIN);
      setStatus(AUTH_STATUS.SIGNED_OUT);
      return;
    }
    const pins = await refreshPinState(next.mode === 'server' ? next.username : null);
    if (fresh) markActive(Date.now(), { force: true });
    setStatus(!fresh && locksWhenIdle(next, pins) && idleTooLong() ? AUTH_STATUS.LOCKED : AUTH_STATUS.READY);
  }, [refreshPinState]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadStoredSession();
      if (!cancelled) await applySession(stored);
    })();
    return () => { cancelled = true; };
  }, [applySession]);

  // Lock after 30 minutes without a tap or key press, also counting time the
  // app spent closed or in the background.
  const canLock = status === AUTH_STATUS.READY && locksWhenIdle(session, pinState);
  useEffect(() => {
    if (!canLock) return undefined;
    return watchInactivity(() => setStatus(AUTH_STATUS.LOCKED));
  }, [canLock]);

  // Renew the sign-in whenever the app is open and online, so a teacher who
  // uses it every week is never signed out.
  const signedInAs = session?.mode === 'server' ? session.username : null;
  useEffect(() => {
    if (!signedInAs) return undefined;
    let cancelled = false;
    const renew = async () => {
      const result = await refreshSession();
      if (cancelled) return;
      if (result.status === 'renewed') setSession(result.session);
      if (result.status === 'signed_out') await applySession(null);
    };
    renew();
    window.addEventListener('online', renew);
    return () => {
      cancelled = true;
      window.removeEventListener('online', renew);
    };
  }, [signedInAs, applySession]);

  /**
   * One sign-in for everyone, always checked by the server. School staff use
   * their email; a name without an @ is the system admin's.
   */
  const signIn = useCallback(async (username, password) => {
    const next = isSystemAdminName(username)
      ? await saveSystemAdminSession(await loginSystemAdmin(username, password))
      : await serverSignIn(username, password);
    // A sign-in the server accepted outranks an offline PIN lockout.
    if (next.mode === 'server') await clearLockout(next.username);
    await applySession(next, { fresh: true });
    return { session: next };
  }, [applySession]);

  /** "Continue with Google" on the sign-in page: only a linked Google account works. */
  const signInWithGoogle = useCallback(async (credential) => {
    const next = await serverGoogleSignIn(credential);
    await clearLockout(next.username);
    await applySession(next, { fresh: true });
    return next;
  }, [applySession]);

  /** Finish setting up with Google from a set-up link ({ token }) or invite code ({ code }). */
  const setUpWithGoogle = useCallback(async (proof, credential) => {
    const next = await serverGoogleSetUp(proof, credential);
    await clearLockout(next.username);
    await applySession(next, { fresh: true });
    return next;
  }, [applySession]);

  /** A school's application. Nobody is signed in; the applicant confirms their email next. */
  const registerSchool = useCallback((application) => serverRegisterSchool(application), []);

  /** Set a password from an emailed set-up or reset link, and sign in. */
  const setPasswordFromLink = useCallback(async (token, password) => {
    const next = await setPasswordWithLink(token, password);
    await clearLockout(next.username);
    await applySession(next, { fresh: true });
    return next;
  }, [applySession]);

  /** A teacher sets their password with the code their school admin gave them. */
  const joinWithCode = useCallback(async (code, password) => {
    const next = await redeemSetupCode(code, password);
    await clearLockout(next.username);
    await applySession(next, { fresh: true });
    return next;
  }, [applySession]);

  /** Keep the device's copy of the school's name and status up to date. */
  const refreshSchool = useCallback(async (school) => {
    const next = await updateStoredSchool(school);
    if (next) setSession(next);
  }, []);

  /** Open the app again after the inactivity lock. Works offline. */
  const unlockWithPin = useCallback(async (pin) => {
    if (!session) throw new Error('No session to unlock');
    try {
      await verifyPin(session.username, pin);
    } catch (err) {
      await refreshPinState(session.username);
      throw err;
    }
    await refreshPinState(session.username);
    markActive(Date.now(), { force: true });
    setStatus(AUTH_STATUS.READY);
  }, [session, refreshPinState]);

  const enrolPin = useCallback(async (pin) => {
    if (!session) throw new Error('No session to attach a PIN to');
    await setPin(session.username, pin);
    markActive(Date.now(), { force: true });
    await refreshPinState(session.username);
  }, [session, refreshPinState]);

  const signOut = useCallback(async () => {
    await clearSession();
    setSession(null);
    setPinState(NO_PIN);
    setStatus(AUTH_STATUS.SIGNED_OUT);
  }, []);

  const value = useMemo(() => ({
    status,
    session,
    pinState,
    user: session
      ? {
          username: session.username,
          displayName: session.displayName,
          jobTitle: session.jobTitle ?? null,
          roles: session.roles ?? [],
          role: session.role ?? 'teacher',
          schoolId: session.schoolId ?? null,
          schoolName: session.schoolName ?? null,
          schoolStatus: session.schoolStatus ?? null,
        }
      : null,
    signIn,
    signInWithGoogle,
    setUpWithGoogle,
    registerSchool,
    joinWithCode,
    setPasswordFromLink,
    refreshSchool,
    signOut,
    unlockWithPin,
    enrolPin,
  }), [
    status, session, pinState, signIn, signInWithGoogle, setUpWithGoogle, registerSchool, joinWithCode, setPasswordFromLink, refreshSchool,
    signOut, unlockWithPin, enrolPin,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}
