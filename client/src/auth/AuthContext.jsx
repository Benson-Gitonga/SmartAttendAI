import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  signIn as cognitoSignIn,
  signUp as cognitoSignUp,
  confirmSignUp as cognitoConfirmSignUp,
  resendConfirmationCode as cognitoResendCode,
  signOut as cognitoSignOut,
  loadStoredSession,
  isSessionValid,
  extendSessionWithPin,
  expireSessionNow,
  isCognitoConfigured,
  isGoogleConfigured,
  startGoogleSignIn,
  completeGoogleSignIn
} from './cognito';
import { verifyPin, setPin, hasPin, getPinStatus, clearLockout } from './pin';
import { loadPendingSignup, savePendingSignup, clearPendingSignup } from './pendingSignup';

const AuthContext = createContext(null);

// A fresh sign-in drops the last user's page, so each role opens on its own home.
function clearRoute() {
  if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

/**
 *   signedOut: no session on the device.
 *   locked:    the session expired; the PIN unlocks it offline.
 *   ready:     signed in.
 */
export const AUTH_STATUS = { LOADING: 'loading', SIGNED_OUT: 'signedOut', LOCKED: 'locked', READY: 'ready' };

export function AuthProvider({ children }) {
  const [status, setStatus] = useState(AUTH_STATUS.LOADING);
  const [session, setSession] = useState(null);
  const [googleError, setGoogleError] = useState(null);
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
    await refreshPinState(next.username);
    setStatus(isSessionValid(next) ? AUTH_STATUS.READY : AUTH_STATUS.LOCKED);
  }, [refreshPinState]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Coming back from Google: finish that sign-in before anything else.
      try {
        const fromGoogle = await completeGoogleSignIn();
        if (cancelled) return;
        if (fromGoogle) {
          clearRoute();
          await clearLockout(fromGoogle.username);
          await applySession(fromGoogle);
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setGoogleError(err.message ?? 'Google sign-in failed');
      }
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

  const signIn = useCallback(async (username, password) => {
    const next = await cognitoSignIn(username, password);
    // An online login outranks an offline lockout.
    await clearLockout(username);
    clearRoute();
    await applySession(next);
    return { session: next, pinEnrolled: await hasPin(username) };
  }, [applySession]);

  const signInWithGoogle = useCallback(async () => {
    setGoogleError(null);
    await startGoogleSignIn();
  }, []);

  const signUp = useCallback(async ({ name, email, password }) => {
    const result = await cognitoSignUp({ name, email, password });
    await clearLockout(email.trim());
    if (!result.needsConfirmation) {
      clearRoute();
      await applySession(result.session);
    }
    return result;
  }, [applySession]);

  const confirmSignUp = useCallback(async (username, code, password) => {
    const next = await cognitoConfirmSignUp(username, code, password);
    if (next) {
      clearRoute();
      await applySession(next);
    }
    return next;
  }, [applySession]);

  const resendConfirmationCode = useCallback(
    (username) => cognitoResendCode(username),
    []
  );

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
    await cognitoSignOut();
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
          roles: session.roles ?? [],
          role: session.role ?? 'teacher',
          schoolId: session.schoolId ?? null,
          schoolName: session.schoolName ?? null,
        }
      : null,
    cognitoConfigured: isCognitoConfigured(),
    googleConfigured: isGoogleConfigured(),
    googleError,
    signIn,
    signInWithGoogle,
    signUp,
    confirmSignUp,
    resendConfirmationCode,
    loadPendingSignup,
    savePendingSignup,
    clearPendingSignup,
    signOut,
    unlockWithPin,
    enrolPin,
    simulateExpiry
  }), [
    status, session, pinState, googleError, signIn, signInWithGoogle, signUp, confirmSignUp,
    resendConfirmationCode, signOut, unlockWithPin, enrolPin, simulateExpiry
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}
