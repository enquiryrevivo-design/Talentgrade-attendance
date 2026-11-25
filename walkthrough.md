# Security Summary

**Reviewed Files**: 19
**Issues Resolved**: 11

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Employee Login & Provisioning | `firestore.rules`, `src/lib/hrService.ts` | `12-19`, `817-921` | Pre-created employee profiles lacked a linked Firebase Auth UID and `roles/{uid}` entry when email was unverified (`emailVerified: false` on Email/Password accounts), causing `get employees/session` and `/api/server-time` permission failures. | High | Fixed | Split `hasAuth()` (non-anonymous Firebase session) from `hasVerifiedEmail()` (required before trusting `email`), provisioned Auth UID before committing atomic `writeBatch` (`employees`, `roles/{uid}`, `leaveLedger`, `celebrationProfiles`), and allowed UID-bound queries without `email_verified`. |
| Unverified Email Claim Risk | `firestore.rules`, `src/lib/hrService.ts` | `33-35`, `531-542` | Email-based profile lookup and admin bootstrap needed strict verification gating so unverified sign-ins could never claim another user's profile by email string. | High | Fixed | Kept `hasVerifiedEmail()` mandatory for `isBootstrappedAdmin()`, claiming `uid == ''` employee records by email, creating `roles/{uid}` by email match, and querying `employees`/`leaveLedger` by email. |
| Server-Clock Auth & 24h Format | `api/server-time.ts`, `server/app.ts` | `88-91`, `89-91` | `/api/server-time` rejected Email/Password employees without `email_verified`, blocking clock sync on punch-in/out; `Intl.DateTimeFormat` lacked explicit `hourCycle: 'h23'`. | High | Fixed | Updated `api/server-time.ts` and `requireAuth` in `server/app.ts` to verify Firebase ID tokens, reject anonymous auth (`403`), accept provisioned password users, and enforce `hourCycle: 'h23'`. |
| Promoted Super Admin Cold-Start | `server/app.ts` | `386-431` | `isVerifiedSuperAdmin` relied on in-memory `SmartAttendanceReminderService` state, failing across Vercel serverless cold starts for promoted Super Admins. | Medium | Fixed | Converted `isVerifiedSuperAdmin` to query the caller's authoritative `roles/{uid}` document via Firestore REST API using their verified Bearer token before checking in-memory fallback. |
| Team Leader Self-Approval | `firestore.rules` | `848`, `873`, `928` | Team Leaders with approval permissions could approve their own regularization requests, delete their own regularization locks, or approve their own leave applications. | High | Fixed | Added `existing().employeeUid != request.auth.uid` checks on Team Leader update/delete rules for `attendanceCorrections`, `regularizationLocks`, and `leaveApplications`. |
| Team Leader Directory & Payroll Scope | `src/lib/hrService.ts`, React Views | `693-717`, `1466-1501` | Views invoked `fetchAllEmployees`, `fetchAttendanceRecords`, and `fetchPayrollRecords` without forwarding `teamLeaderPermissions`, risking mismatched queries against Firestore rules. | Medium | Fixed | Added `canViewAll` (`uid` + `managerUid` scoped fallback) and `canViewSalary` flags across `hrService.ts` and all view callers (`DashboardView`, `AttendanceView`, `LeavesView`, `ReportsView`, `EmployeesView`, `PayrollView`). |
| Null Document `get` Guarding | `firestore.rules` | `671-1060` | Single-document `allow get` rules evaluated `resource.data` without checking `resource == null`, producing false permission-denied errors when checking non-existent IDs. | Medium | Fixed | Added `resource == null` checks across all protected collection `allow get` rules. |
| Serverless Crash Containment | `api/index.ts`, `src/lib/*` | `39-52` | Uncaught handler errors returned raw Vercel crashes instead of JSON, and client API helpers lacked 401 refresh retry on expired Firebase tokens. | Medium | Fixed | Wrapped `api/index.ts` in structured JSON error handling and added single-retry `getIdToken(true)` + JSON error extraction in `hrService.ts`, `pushService.ts`, `regularizationService.ts`, and `celebrationService.ts`. |
| First-Login Password Error Handling | `src/context/AuthContext.tsx` | `137-153` | Expired auth sessions (`auth/requires-recent-login`) or short passwords (`auth/weak-password`) during forced first-login password reset surfaced raw Firebase errors. | Low | Fixed | Mapped both Firebase Auth error codes to clear remediation messages before updating `mustChangePassword`. |
| NaN & Numeric Bounds Guards | `src/lib/hrService.ts`, View Inputs | `770-782`, View forms | Clearing numeric inputs produced `NaN` values (`Number('')` / `Number('e')`), risking corrupt payroll, leave balance, or schedule calculations. | Medium | Fixed | Added `Number.isFinite` and min/max clamping across `hrService.ts` write methods and numeric form inputs in `EmployeesView`, `PayrollView`, `SettingsView`, and `AdminSmartRemindersPanel`. |
| Transitive Package Advisories | `package.json`, `bun.lock` | — | `bun audit` reports 5 transitive advisories (`@grpc/grpc-js` high/low, `glob` moderate, `minimatch` moderate, `uuid` moderate) inside `firebase`, `firebase-admin`, `vite-plugin-pwa`, `eslint`, and `@google/genai`. | Low | Needs Follow-Up | Documented without upgrading `firebase-admin` above v13 because v14 breaks Vercel serverless Node.js builds (`ERR_REQUIRE_ESM` in `jwks-rsa`/`jose`); none of the client-facing endpoints expose vulnerable gRPC server or untrusted filesystem globbing paths. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Firebase Admin Scope | `server/app.ts`, `api/server-time.ts` | Uses `firebase-admin/app` + `firebase-admin/auth` solely for server-side ID token verification with environment/config project resolution (`resolveFirebaseConfig`); no private service account keys in source. |
| Firestore Access Control | `firestore.rules` | Default deny-all fallback (`allow read, write: if false`), role-verified helpers (`roles/{uid}`), field allow-lists (`hasOnly`), server timestamp enforcement (`request.time`), and immutability on `leaveLedger` and `auditLogs`. |
| API Rate Limiting & Auth | `server/app.ts` | Applies `express-rate-limit` (120 req/min) across `/api/*` and enforces `requireAuth` Bearer JWT verification (rejecting anonymous tokens) on every API endpoint. |
| Attendance & Time Authority | `api/server-time.ts`, `src/lib/hrService.ts` | Server clock synchronization computes UTC timestamp and local IANA timezone (`hourCycle: 'h23'`); `punchIn` uses `tx.update` on pre-existing docs to satisfy immutable creation-field rules. |
| Client Credential Hygiene | `src/lib/hrService.ts` | Employee creation provisions Email/Password login via a short-lived secondary Firebase App instance (`createUserWithEmailAndPassword` + immediate cleanup) so the Super Admin's active session is never displaced. |

## PoC Verification

### 1. Newly Provisioned Email/Password Employee Login & Clock Sync
#### Summary
| Field | Value |
|---|---|
| Issue Type | Broken UID Linking & Unverified Password Auth Block |
| Impact | High |
| Affected File | `src/lib/hrService.ts:817-921`, `firestore.rules:12-19`, `api/server-time.ts:87-91` |
| Test Scenario | Super Admin creates `akshaya@talentgradehr.com` with temporary password -> employee signs in (`emailVerified: false`) -> resolves `employees/session` -> fetches `/api/server-time` |

#### How It Was Fixed
Employee provisioning now creates the Firebase Auth account first via a secondary app instance to capture the real UID, then commits `employees`, `roles/{uid}`, `leaveLedger`, and `celebrationProfiles` in one `writeBatch`. Both Firestore rules (`hasAuth()`) and `/api/server-time` permit non-anonymous UID-bound sessions without requiring `email_verified`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Super Admin submits Add Employee form -> `createEmployeeAccount` validates inputs (`hrService.ts:760-787`) and calls `createUserWithEmailAndPassword` (`822`) | Authoritative `provisionedUid` returned |
| 2 | `writeBatch` writes `employees/{id}` (`uid: provisionedUid`), `roles/{provisionedUid}`, `leaveLedger`, and `celebrationProfiles` atomically (`909-985`) | Firestore records bound to Auth UID |
| 3 | Employee signs in with Email/Password -> `resolveEmployeeSession` queries `employees` where `uid == user.uid` (`526`) and reads `roles/{uid}` (`583`) | Session resolves cleanly without permission error |
| 4 | Employee opens Punch-In modal -> calls `/api/server-time?tz=Asia/Kolkata` with Bearer ID token (`api/server-time.ts:87-91`) | Verified non-anonymous token succeeds (`200 OK`, `h23` time) |

#### Conclusion
**Fix Verified** - Newly provisioned Email/Password employees resolve their profile, pass Firestore security checks, and synchronize authoritative server time on first login.

---

### 2. Unverified Email Claim Prevention & Team Leader Self-Approval Block
#### Summary
| Field | Value |
|---|---|
| Issue Type | Missing Email Verification on Email Claims & Missing Self-Approval Guard |
| Impact | High |
| Affected File | `firestore.rules:33-35`, `firestore.rules:671-693`, `firestore.rules:848`, `firestore.rules:928` |
| Test Scenario | (A) Unverified user attempts to claim `employees` or bootstrap admin by email; (B) Team Leader with `canApproveLeaves` attempts to update their own `leaveApplications` document |

#### How It Was Fixed
Email-based identity matching (`isBootstrappedAdmin()`, claiming `uid == ''` profiles, creating `roles/{uid}` by email match) strictly requires `hasVerifiedEmail()` (`email_verified == true`). Approval updates on `leaveApplications`, `attendanceCorrections`, and lock deletions on `regularizationLocks` explicitly require `existing().employeeUid != request.auth.uid` for Team Leaders.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | User with `email_verified: false` queries `employees` by email (`resolveEmployeeSession` line `531`) or tries Firestore `get` matching email | Client skips email lookup; `firestore.rules` denies via `hasVerifiedEmail()` |
| 2 | Team Leader with `canApproveLeaves == true` attempts `update` on `leaveApplications/{id}` where `resource.data.employeeUid == request.auth.uid` | Reaches rule at `firestore.rules:928` (`existing().employeeUid != request.auth.uid`) |
| 3 | Firestore evaluates rule condition to `false` | **Blocked (`PERMISSION_DENIED`)** |

#### Conclusion
**Fix Verified** - Unverified email logins cannot hijack accounts by email, and Team Leaders cannot self-approve leave or attendance regularization requests.

---

### 3. Unauthenticated & Anonymous API Access Blocked
#### Summary
| Field | Value |
|---|---|
| Issue Type | Protected API Authentication Verification |
| Impact | High |
| Affected File | `server/app.ts:81-99`, `api/server-time.ts:79-96`, `api/index.ts:39-52` |
| Test Scenario | HTTP requests to all `/api/*` endpoints with missing Bearer token, malformed JWT, or Vercel `__path` rewrite without authorization |

#### How It Was Fixed
Every `/api/*` route applies `requireAuth` (or equivalent token check in `api/server-time.ts`), rejecting missing/malformed Bearer headers with `401` JSON and anonymous providers with `403` JSON.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Unauthenticated `GET /api/index?__path=/api/server-time` arrives at `api/index.ts:39` | `restoreRewrittenApiUrl` restores `/api/server-time` |
| 2 | Express dispatches to `requireAuth` (`server/app.ts:81`) | Missing `Authorization: Bearer` header detected -> returns `401` JSON |
| 3 | Request with invalid JWT (`Bearer invalid.jwt.token`) hits `/api/leave/accrual/compute` | `getAdminAuth().verifyIdToken` fails -> returns `401` JSON |

#### Conclusion
**Fix Verified** - Confirmed via live local HTTP execution across all 14 Express API routes and the standalone `/api/server-time` serverless handler.
