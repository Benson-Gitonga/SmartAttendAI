import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  signIn as serverSignIn,
  registerSchool as serverRegisterSchool,
  redeemSetupCode,
  signOut as clearSession,
  loadStoredSession,
  isSessionValid,
  extendSessionWithPin,
  expireSessionNow,
  saveSystemAdminSession,
  updateStoredSchool,
} from './session';
import { loginSystemAdmin } from '../services/systemAdminService';
import { verifyPin, setPin, hasPin, getPinStatus, clearLockout } from './pin';

const AuthContext = createContext(null);

// School staff sign in with an email; the system admin's name has no @.
const isSystemAdminName = (username) => Boolean(username?.trim()) && !username.includes('@');

/**
 *   signedOut: no session on the device.
 *   locked:    the app locked itself after an hour; the PIN unlocks it offline.
 *   ready:     signed in.
 */
export const AUTH_STATUS = { LOADING: 'loading', SIGNED_OUT: 'signedOut', LOCKED: 'locked', READY: 'ready' };

export function AuthProvider({ children }) {
  const [status, setStatus] = useState(AUTH_STATUS.LOADING);
  const [session, setSession] = useState(null);
  const [pinState, setPinState] = useState({ enrolled: false, locked: false, attemptsRemaining: 3 });

  const refreshPinState = useCallback(async (username) => {
    if (!username) return;
    setPinState(await getPinStatus(username));
  }, []);

  const applySession = useCallback(async (next) => {
    setSession(next);
    if (!next) {
      setStatus(AUTH_STATUS.SIGNED_OUT);
      return;
    }
    // An expired system admin sign-in cannot be unlocked with a PIN: the
    // server's token has run out, so they sign in again.
    if (next.role === 'system_admin' && !isSessionValid(next)) {
      await clearSession();
      setSession(null);
      setStatus(AUTH_STATUS.SIGNED_OUT);
      return;
    }
    await refreshPinState(next.username);
    setStatus(isSessionValid(next) ? AUTH_STATUS.READY : AUTH_STATUS.LOCKED);
  }, [refreshPinState]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadStoredSession();
      if (cancelled) return;
      if (!stored) {
        setStatus(AUTH_STATUS.SIGNED_OUT);
        return;
      }
      await applySession(stored);
    })();
    return () => { cancelled = true; };
  }, [applySession]);

  /**
   * One sign-in for everyone, always checked by the server. School staff use
   * their email; a name without an @ is the system admin's.
   */
  const signIn = useCallback(async (username, password) => {
    if (isSystemAdminName(username)) {
      const next = await saveSystemAdminSession(await loginSystemAdmin(username, password));
      await applySession(next);
      return { session: next, pinEnrolled: false };
    }
    const next = await serverSignIn(username, password);
    // A sign-in the server accepted outranks an offline PIN lockout.
    await clearLockout(next.username);
    await applySession(next);
    return { session: next, pinEnrolled: await hasPin(next.username) };
  }, [applySession]);

  /** A school's application. The applicant is signed in as its admin while it waits. */
  const registerSchool = useCallback(async (application) => {
    const next = await serverRegisterSchool(application);
    await clearLockout(next.username);
    await applySession(next);
    return next;
  }, [applySession]);

  /** A teacher sets their password with the code their school admin gave them. */
  const joinWithCode = useCallback(async (code, password) => {
    const next = await redeemSetupCode(code, password);
    await clearLockout(next.username);
    await applySession(next);
    return next;
  }, [applySession]);

  /** Keep the device's copy of the school's name and status up to date. */
  const refreshSchool = useCallback(async (school) => {
    const next = await updateStoredSchool(school);
    if (next) setSession(next);
  }, []);

  const unlockWithPin = useCallback(async (pin) => {
    if (!session) throw new Error('No session to unlock');
    try {
      await verifyPin(session.username, pin);
    } catch (err) {
      await refreshPinState(session.username);
      throw err;
    }
    const next = await extendSessionWithPin(session);
    await applySession(next);
    return next;
  }, [session, applySession, refreshPinState]);

  const enrolPin = useCallback(async (pin) => {
    if (!session) throw new Error('No session to attach a PIN to');
    await setPin(session.username, pin);
    await refreshPinState(session.username);
  }, [session, refreshPinState]);

  const signOut = useCallback(async () => {
    await clearSession();
    setSession(null);
    setPinState({ enrolled: false, locked: false, attemptsRemaining: 3 });
    setStatus(AUTH_STATUS.SIGNED_OUT);
  }, []);

  const simulateExpiry = useCallback(async () => {
    const expired = await expireSessionNow();
    if (expired) await applySession(expired);
  }, [applySession]);

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
    registerSchool,
    joinWithCode,
    refreshSchool,
    signOut,
    unlockWithPin,
    enrolPin,
    simulateExpiry
  }), [
    status, session, pinState, signIn, registerSchool, joinWithCode, refreshSchool, signOut, unlockWithPin, enrolPin, simulateExpiry
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}
