import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  onIdTokenChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
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
import { fetchMediaAsset, resolveEmployeeSession } from '../lib/hrService';
import { syncReminderSnapshotToServer } from '../lib/pushService';

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
      const empCompany =
        resolved.employee && resolved.employee.role !== 'super_admin'
          ? resolved.employee.companyId || 'talentgrade'
          : 'talentgrade';
      const logoAssetId =
        empCompany === 'mygrade'
          ? resolved.settings?.companies?.mygrade?.logoAssetId || ''
          : resolved.settings?.companies?.talentgrade?.logoAssetId ||
            resolved.settings?.logoAssetId ||
            '';
      if (logoAssetId) {
        const asset = await fetchMediaAsset(logoAssetId);
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
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
