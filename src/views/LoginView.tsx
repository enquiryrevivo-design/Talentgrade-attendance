import React, { useEffect, useState } from 'react';
import { Lock, Mail, Eye, EyeOff, ArrowRight, ShieldCheck, Loader2, KeyRound, RefreshCw } from 'lucide-react';
import { ProfileSyncPendingError, ReauthRequiredError, useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { TalentGradeLogo } from '../components/TalentGradeLogo';

export function LoginView() {
  const {
    firebaseUser,
    signInWithGoogle,
    signInWithEmail,
    requestPasswordReset,
    refreshSession,
    logout,
    clearAuthError,
    authError,
    loading,
    settings,
    companyLogoUrl,
  } = useAuth();
  const { showToast } = useToast();

  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const companyName = settings?.companyName || 'TalentGrade';

  const handleGoogle = async () => {
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch {
      // authError displayed cleanly
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      if (mode === 'reset') {
        await requestPasswordReset(email);
        showToast('Password reset link sent if your account uses Email/Password auth.', 'success');
        setMode('signin');
      } else {
        await signInWithEmail(email, password);
      }
    } catch {
      // authError displayed cleanly
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 grid lg:grid-cols-2 items-stretch">
      {/* Left: Clean Workspace Editorial Photo */}
      <div className="hidden lg:block relative overflow-hidden bg-black">
        <img
          src="/src/assets/images/office_workspace_backdrop_1795432457322.jpg"
          alt="TalentGrade workspace"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
        <div className="absolute bottom-10 left-10 right-10 text-white space-y-3 max-w-lg">
          <div className="text-xs font-semibold tracking-wide text-[#B5121B] uppercase">
            TalentGrade · India &amp; Dubai, UAE
          </div>
          <h2 className="text-3xl font-display font-semibold leading-tight">
            Attendance, leave approvals, and payroll in one quiet place.
          </h2>
          <p className="text-sm text-zinc-300 leading-relaxed">
            Authorized TalentGrade personnel only. Sign in with your registered corporate account to punch attendance, manage leave requests, and download payslips.
          </p>
        </div>
      </div>

      {/* Right: Auth Card */}
      <div className="flex items-center justify-center p-6 sm:p-10 bg-white dark:bg-zinc-950">
        <div className="w-full max-w-md space-y-7">
          <div className="space-y-3">
            <TalentGradeLogo logoUrl={companyLogoUrl} companyName={companyName} />
            <h1 className="text-2xl sm:text-3xl font-display font-semibold text-zinc-950 dark:text-zinc-100 pt-1">
              {companyName} Workforce Portal
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {mode === 'reset'
                ? 'Enter your corporate email to receive a password reset link.'
                : 'Sign in with your assigned work account to continue.'}
            </p>
          </div>

          {authError && (
            <div
              role="alert"
              className="p-3.5 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-[#B5121B] dark:text-red-300 leading-relaxed space-y-2"
            >
              <div>{authError}</div>
              {firebaseUser && (
                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => void refreshSession()}
                    className="inline-flex items-center gap-1 font-semibold underline hover:opacity-80"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry Session
                  </button>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="font-medium text-zinc-700 dark:text-zinc-300 underline hover:opacity-80"
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          )}

          {mode === 'signin' && (
            <div className="space-y-4">
              <button
                type="button"
                disabled={submitting || loading}
                onClick={handleGoogle}
                className="w-full min-h-[48px] flex items-center justify-center gap-3 px-5 py-3 rounded-xl bg-black dark:bg-white text-white dark:text-black font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {submitting || loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4 text-[#B5121B]" />
                )}
                <span>Sign in with Company Google Account</span>
              </button>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-zinc-200 dark:border-zinc-800" />
                <button
                  type="button"
                  onClick={() => setShowEmailForm((v) => !v)}
                  className="px-3 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                >
                  {showEmailForm ? 'Hide email & password form' : 'Or sign in with email & password'}
                </button>
                <div className="flex-grow border-t border-zinc-200 dark:border-zinc-800" />
              </div>
            </div>
          )}

          {(showEmailForm || mode === 'reset') && (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Work Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@talentgrade.io"
                    className="w-full min-h-[46px] pl-10 pr-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#B5121B]"
                  />
                </div>
              </div>

              {mode === 'signin' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        clearAuthError();
                        setMode('reset');
                      }}
                      className="text-xs font-medium text-[#B5121B] dark:text-red-400 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                      className="w-full min-h-[46px] pl-10 pr-11 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#B5121B]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-400 hover:text-zinc-700"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
                <span>{mode === 'reset' ? 'Send Reset Link' : 'Sign In with Password'}</span>
              </button>

              {mode === 'reset' && (
                <button
                  type="button"
                  onClick={() => {
                    clearAuthError();
                    setMode('signin');
                  }}
                  className="w-full text-center text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:underline"
                >
                  Back to sign in
                </button>
              )}
            </form>
          )}

          <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed pt-2 border-t border-zinc-200 dark:border-zinc-800">
            Accounts are provisioned internally by your Super Admin. Public self-registration is disabled.
          </p>
        </div>
      </div>
    </div>
  );
}

export function ForcePasswordChangeModal() {
  const { employee, completeFirstLoginPasswordChange, logout } = useAuth();
  const { showToast } = useToast();
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [passwordSavedInAuth, setPasswordSavedInAuth] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setCurrentPass('');
    setNewPass('');
    setConfirmPass('');
    setShowNewPass(false);
    setShowConfirmPass(false);
    setNeedsReauth(false);
    setPasswordSavedInAuth(false);
    setRetryCount(0);
    setSaving(false);
    setErr('');
  }, [employee?.id]);

  if (!employee?.mustChangePassword) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setErr('');
    if (!passwordSavedInAuth) {
      if (newPass.length < 8) {
        setErr('Password must be at least 8 characters long.');
        return;
      }
      if (newPass !== confirmPass) {
        setErr('Passwords do not match.');
        return;
      }
      if (needsReauth && !currentPass) {
        setErr('Please enter your current password to verify this change.');
        return;
      }
    }

    const nextRetryAttempt = passwordSavedInAuth ? retryCount + 1 : 0;
    setSaving(true);
    try {
      await completeFirstLoginPasswordChange(newPass, {
        currentPassword: needsReauth ? currentPass : undefined,
        skipAuthUpdate: passwordSavedInAuth,
        retryAttempt: nextRetryAttempt,
      });
      showToast('Password updated successfully.', 'success');
    } catch (error: unknown) {
      if (error instanceof ReauthRequiredError) {
        setNeedsReauth(true);
      } else if (error instanceof ProfileSyncPendingError) {
        setPasswordSavedInAuth(true);
        if (nextRetryAttempt > 0) {
          setRetryCount(nextRetryAttempt);
        }
      }
      setErr(error instanceof Error ? error.message : 'Unable to update password. Please retry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#B5121B]/10 text-[#B5121B] dark:text-red-400 flex items-center justify-center">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-100">
              Password Change Required
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Set a personal password before accessing your workspace.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {passwordSavedInAuth && (
            <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              Your new password is saved in authentication. Click <strong>Retry Sync</strong> below to complete your workspace profile activation.
            </div>
          )}

          {needsReauth && !passwordSavedInAuth && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Current Temporary Password
              </label>
              <input
                type="password"
                required
                value={currentPass}
                onChange={(e) => setCurrentPass(e.target.value)}
                placeholder="Enter current password"
                className="w-full min-h-[44px] px-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm"
              />
            </div>
          )}

          {!passwordSavedInAuth && (
            <>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  New Password (min 8 characters)
                </label>
                <div className="relative">
                  <input
                    type={showNewPass ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    className="w-full min-h-[44px] pl-3.5 pr-11 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPass((v) => !v)}
                    aria-label={showNewPass ? 'Hide new password' : 'Show new password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-400 hover:text-zinc-700"
                  >
                    {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPass ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={confirmPass}
                    onChange={(e) => setConfirmPass(e.target.value)}
                    className="w-full min-h-[44px] pl-3.5 pr-11 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPass((v) => !v)}
                    aria-label={showConfirmPass ? 'Hide confirm password' : 'Show confirm password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-zinc-400 hover:text-zinc-700"
                  >
                    {showConfirmPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </>
          )}

          {err && (
            <p role="alert" className="text-xs text-[#B5121B] dark:text-red-400 leading-relaxed">
              {err}
            </p>
          )}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={logout}
              className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium disabled:opacity-50"
            >
              Sign Out
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 min-h-[44px] rounded-xl bg-[#B5121B] text-white text-sm font-medium hover:bg-[#960E16] disabled:opacity-50"
            >
              {saving
                ? passwordSavedInAuth
                  ? 'Retrying Sync...'
                  : 'Updating...'
                : passwordSavedInAuth
                  ? 'Retry Sync'
                  : 'Save Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
