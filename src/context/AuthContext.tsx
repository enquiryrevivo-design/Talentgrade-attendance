import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
  signOut,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { CompanySettings, Employee } from '../types/hr';
import { completeFirstLoginPasswordChangeInApp, fetchMediaAsset, resolveEmployeeSession } from '../lib/hrService';
import { syncReminderSnapshotToServer } from '../lib/pushService';

interface AuthContextValue {
  firebaseUser: User | null;
  employee: Employee | null;
  settings: CompanySettings | null;
  companyLogoUrl: string | null;
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  completeFirstLoginPasswordChange: (newPassword: string) => Promise<void>;
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
      const msg = err instanceof Error ? err.message : 'Unable to verify company account.';
      setAuthError(msg);
      setEmployee(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      loadSession(user);
    });
    return () => unsub();
  }, [loadSession]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      setAuthError(msg);
      throw err;
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setAuthError('Email/Password sign-in is not enabled on Firebase Auth. Use Google Sign-In or enable Email/Password in Firebase Console.');
      } else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        setAuthError('Invalid work email or password. Repeated failed attempts may temporarily lock your account.');
      } else if (code === 'auth/too-many-requests') {
        setAuthError('Too many failed login attempts. Account temporarily locked for security. Please wait or reset your password.');
      } else {
        setAuthError(err instanceof Error ? err.message : 'Sign-in failed.');
      }
      throw err;
    }
  };

  const requestPasswordReset = async (email: string) => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not send password reset email.';
      setAuthError(msg);
      throw err;
    }
  };

  const completeFirstLoginPasswordChange = async (newPassword: string) => {
    const activeUser = auth.currentUser || firebaseUser;
    if (!activeUser || !employee) throw new Error('No active session');
    try {
      await updatePassword(activeUser, newPassword);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/requires-recent-login') {
        throw new Error('For your security, please click Sign Out, log back in with your temporary password, and set your new password immediately.');
      }
      if (code === 'auth/weak-password') {
        throw new Error('Please choose a stronger password with at least 8 characters.');
      }
      throw err;
    }

    // updatePassword rotates auth refresh tokens; force-refresh the ID token before persisting profile state.
    await activeUser.getIdToken(true);
    const resolvedEmployeeId = await completeFirstLoginPasswordChangeInApp(employee);
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
