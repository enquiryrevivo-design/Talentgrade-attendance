export interface ParsedAuthError {
  code: string;
  message: string;
  isCredentialError: boolean;
}

export function extractFirebaseAuthCode(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const maybeCode = (err as { code?: unknown }).code;
  if (typeof maybeCode === 'string' && maybeCode.trim()) {
    return maybeCode.trim();
  }
  const msg = err instanceof Error ? err.message : '';
  const match = msg.match(/\((auth\/[a-z0-9-]+)\)/i);
  return match ? match[1].toLowerCase() : '';
}

export function formatEmailSignInError(
  err: unknown,
  context?: { signInMethods?: string[] }
): ParsedAuthError {
  const code = extractFirebaseAuthCode(err);
  const methods = context?.signInMethods || [];

  switch (code) {
    case 'auth/wrong-password':
      return {
        code,
        isCredentialError: true,
        message:
          'Incorrect password for this account. Check Caps Lock or extra spaces, or click "Forgot password?" to reset it.',
      };

    case 'auth/user-not-found':
      return {
        code,
        isCredentialError: true,
        message:
          'No Email/Password account was found for this email. Verify your work email, use "Sign in with Company Google Account", or contact your Super Admin.',
      };

    case 'auth/invalid-credential': {
      const hasGoogle = methods.includes('google.com');
      const hasPassword = methods.includes('password');
      if (hasGoogle && !hasPassword) {
        return {
          code,
          isCredentialError: true,
          message:
            'This email uses Google Sign-In (Email/Password sign-in is not active on this account—signing in with Google replaces unverified password credentials). Please click "Sign in with Company Google Account" or use "Forgot password?" to set a password.',
        };
      }
      return {
        code,
        isCredentialError: true,
        message:
          'Credentials could not be verified: either the password is incorrect, or this account is linked to Company Google Sign-In instead of Email/Password. Try Google Sign-In or use "Forgot password?" to reset.',
      };
    }

    case 'auth/user-disabled':
      return {
        code,
        isCredentialError: false,
        message:
          'Your authentication account has been disabled by an administrator. Please contact your Super Admin.',
      };

    case 'auth/too-many-requests':
      return {
        code,
        isCredentialError: false,
        message:
          'Too many failed sign-in attempts. Access is temporarily paused by security protection—please wait a few minutes or use "Forgot password?".',
      };

    case 'auth/network-request-failed':
      return {
        code,
        isCredentialError: false,
        message:
          'Network error reaching authentication service. Please check your internet connection and try again.',
      };

    case 'auth/invalid-email':
      return {
        code,
        isCredentialError: true,
        message: 'Please enter a valid work email address.',
      };

    case 'auth/operation-not-allowed':
      return {
        code,
        isCredentialError: false,
        message:
          'Email/Password sign-in is not enabled on Firebase Auth. Use Google Sign-In or enable Email/Password in Firebase Console.',
      };

    default: {
      const rawMsg = err instanceof Error ? err.message : 'Sign-in failed.';
      return {
        code: code || 'auth/unknown',
        isCredentialError: false,
        message: code ? `Authentication error (${code}): ${rawMsg}` : rawMsg,
      };
    }
  }
}

export function formatGoogleSignInError(err: unknown): string {
  const code = extractFirebaseAuthCode(err);
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in popup was closed before completing authentication.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in popup. Please allow popups for this site and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method. Sign in with your Email & Password instead.';
    case 'auth/user-disabled':
      return 'Your authentication account has been disabled by an administrator.';
    case 'auth/network-request-failed':
      return 'Network error while connecting to Google Sign-In. Please check your connection and try again.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Google Sign-In in Firebase Authentication settings.';
    default:
      return err instanceof Error ? err.message : 'Google sign-in failed.';
  }
}

export function formatPasswordResetError(err: unknown): string {
  const code = extractFirebaseAuthCode(err);
  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid work email address.';
    case 'auth/user-not-found':
      return 'No Email/Password account was found for that email address.';
    case 'auth/too-many-requests':
      return 'Too many reset requests. Please wait a few minutes before trying again.';
    case 'auth/network-request-failed':
      return 'Network error while sending password reset email. Check your internet connection and retry.';
    default:
      return err instanceof Error ? err.message : 'Could not send password reset email.';
  }
}

export function formatSessionResolutionError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');

  // Extract inner error when wrapped by handleFirestoreError JSON payload
  let innerError = raw;
  let path = '';
  try {
    const parsed = JSON.parse(raw) as { error?: string; path?: string };
    if (parsed && typeof parsed.error === 'string') {
      innerError = parsed.error;
      path = typeof parsed.path === 'string' ? parsed.path : '';
    }
  } catch {
    // Not JSON-wrapped
  }

  const lower = innerError.toLowerCase();
  if (lower.includes('quota')) {
    return 'Daily database read/write quota has been reached. Your login credentials are valid, but workspace data is temporarily unavailable.';
  }
  if (lower.includes('offline') || lower.includes('unavailable') || lower.includes('network') || lower.includes('failed to fetch')) {
    return 'Signed in, but could not reach the company workspace database. Check your internet connection and click "Retry Session".';
  }
  if (lower.includes('permission') || lower.includes('insufficient')) {
    return `Signed in, but workspace profile permissions were denied${path ? ` (${path})` : ''}. Please click "Retry Session" or contact your Super Admin.`;
  }
  if (lower.includes('unauthenticated') || lower.includes('token') || lower.includes('401')) {
    return 'Your session token needs to refresh. Please click "Retry Session" or sign in again.';
  }
  return innerError || 'Signed in, but could not load your employee profile. Please retry.';
}
