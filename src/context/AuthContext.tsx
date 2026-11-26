import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  User,
  EmailAuthProvider,
  onAuthStateChanged,
  onIdTokenChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  fetchSignInMethodsForEmail,
  signOut,
} from 'firebase/auth';
import { auth, authPersistenceReady, googleAuthProvider } from '../lib/firebase';
import {
  extractFirebaseAuthCode,
  formatEmailSignInError,
  formatGoogleSignInError,
  formatPasswordResetError,
  formatSessionResolutionError,
} from '../lib/authErrors';
import { CompanySettings, Employee } from '../types/hr';
import { completeFirstLoginPasswordChangeInApp, fetchMediaAsset, resolveEmployeeSession } from '../lib/hrService';
import { syncReminderSnapshotToServer } from '../lib/pushService';

export class ReauthRequiredError extends Error {
  readonly requiresReauth = true;
  constructor(message: string) {
    super(message);
    this.name = 'ReauthRequiredError';
  }
}

export class ProfileSyncPendingError extends Error {
  readonly passwordAlreadyUpdatedInAuth = true;
  constructor(message: string) {
    super(message);
    this.name = 'ProfileSyncPendingError';
  }
}

interface AuthContextValue {
  firebaseUser: User | null;
  employee: Employee | null;
  settings: CompanySettings | null;
  companyLogoUrl: string | null;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  completeFirstLoginPasswordChange: (
    newPassword: string,
    options?: { currentPassword?: string; skipAuthUpdate?: boolean }
  ) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadSession = useCallback(async (user: User | null) => {
    if (!user) {
      setEmployee(null);
      setSettings(null);
      setCompanyLogoUrl(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setAuthError(null);
    try {
      const resolved = await resolveEmployeeSession(user);
      setSettings(resolved.settings);
      if (resolved.settings?.logoAssetId) {
        const asset = await fetchMediaAsset(resolved.settings.logoAssetId);
        setCompanyLogoUrl(asset?.dataUrl || null);
      } else {
        setCompanyLogoUrl(null);
      }

      if (!resolved.employee) {
        setEmployee(null);
        setAuthError(resolved.errorReason || 'Account access unavailable.');
        await signOut(auth);
      } else {
        setEmployee(resolved.employee);
        void syncReminderSnapshotToServer({
          employee: resolved.employee,
          settings: resolved.settings,
        }).catch(() => {});
      }
    } catch (err: unknown) {
      setAuthError(formatSessionResolutionError(err));
      setEmployee(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      void loadSession(user);
    });
    const unsubToken = onIdTokenChanged(auth, (user) => {
      setFirebaseUser(user);
    });
    return () => {
      unsubAuth();
      unsubToken();
    };
  }, [loadSession]);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await authPersistenceReady;
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: unknown) {
      setAuthError(formatGoogleSignInError(err));
      throw err;
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    setAuthError(null);
    const cleanEmail = email.trim();
    try {
      await authPersistenceReady;
      await signInWithEmailAndPassword(auth, cleanEmail, password);
    } catch (err: unknown) {
      const code = extractFirebaseAuthCode(err);
      let signInMethods: string[] = [];
      if (code === 'auth/invalid-credential' && cleanEmail) {
        signInMethods = await fetchSignInMethodsForEmail(auth, cleanEmail).catch(() => []);
      }
      const parsed = formatEmailSignInError(err, { signInMethods });
      setAuthError(parsed.message);
      throw err;
    }
  };

  const requestPasswordReset = async (email: string) => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err: unknown) {
      setAuthError(formatPasswordResetError(err));
      throw err;
    }
  };

  const completeFirstLoginPasswordChange = async (
    newPassword: string,
    options?: { currentPassword?: string; skipAuthUpdate?: boolean }
  ) => {
    const activeUser = auth.currentUser || firebaseUser;
    if (!activeUser || !employee) throw new Error('No active session');

    if (!options?.skipAuthUpdate) {
      if (options?.currentPassword && activeUser.email) {
        try {
          const cred = EmailAuthProvider.credential(activeUser.email, options.currentPassword);
          await reauthenticateWithCredential(activeUser, cred);
        } catch (reauthErr: unknown) {
          const code = extractFirebaseAuthCode(reauthErr);
          if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
            throw new Error('The current password you entered is incorrect.');
          }
          if (code === 'auth/too-many-requests') {
            throw new Error('Too many failed verification attempts. Please wait a few minutes and try again.');
          }
          throw new Error(reauthErr instanceof Error ? reauthErr.message : 'Could not verify your current password.');
        }
      }

      try {
        await updatePassword(activeUser, newPassword);
      } catch (err: unknown) {
        const code = extractFirebaseAuthCode(err);
        if (code === 'auth/requires-recent-login') {
          throw new ReauthRequiredError(
            'For your security, please enter your current temporary password below to confirm your new password.'
          );
        }
        if (code === 'auth/weak-password') {
          throw new Error('Please choose a stronger password with at least 8 characters.');
        }
        throw err;
      }
    }

    // updatePassword rotates auth refresh tokens; force-refresh the ID token before persisting profile state.
    await activeUser.getIdToken(true);
    let resolvedEmployeeId: string;
    try {
      resolvedEmployeeId = await completeFirstLoginPasswordChangeInApp(employee);
    } catch (syncErr: unknown) {
      const detail = syncErr instanceof Error ? syncErr.message : 'Could not update profile status.';
      throw new ProfileSyncPendingError(
        `Your new password is saved in authentication, but workspace profile sync failed (${detail}). Click "Retry Sync" below to complete setup.`
      );
    }

    setEmployee((prev) =>
      prev ? { ...prev, id: resolvedEmployeeId || prev.id, mustChangePassword: false } : prev
    );

    void resolveEmployeeSession(activeUser)
      .then((res) => {
        if (res?.employee) {
          setEmployee(res.employee);
          setSettings(res.settings);
        }
      })
      .catch(() => {});
  };

  const logout = async () => {
    setAuthError(null);
    await signOut(auth);
    setEmployee(null);
  };

  const refreshSession = async () => {
    if (auth.currentUser) {
      await loadSession(auth.currentUser);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        employee,
        settings,
        companyLogoUrl,
        loading,
        authError,
        clearAuthError,
        signInWithGoogle,
        signInWithEmail,
        requestPasswordReset,
        completeFirstLoginPasswordChange,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
