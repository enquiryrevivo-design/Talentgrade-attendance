# Security Specification — PeopleDesk Internal HR

## 1. Data Invariants
1. Employees can ONLY read and write their own attendance records, attendance photos, leave applications, and attendance correction requests.
2. Employees can NEVER read `employeeSalaries` or `payrollRecords` belonging to any other employee, and can only view their own `payrollRecords` when `status == 'Published'`.
3. Employees can NEVER self-assign or escalate their `role`, `status`, or leave balances.
4. `roles/{uid}` can ONLY be written by the Super Admin (or bootstrapped Super Admin email).
5. `employeeSalaries/{employeeId}` and `payrollRecords/{payrollId}` are strictly restricted to Super Admin (and never readable by regular Employees or Team Leaders unless explicitly permitted).
6. All `createdAt` and `updatedAt` timestamps on new documents and modifications must equal `request.time`.
7. `auditLogs/{logId}` are append-only (no client update or delete permitted).
8. Every authenticated write requires `request.auth.token.email_verified == true`.
9. Expense claims (`expenses/{expenseId}`) may ONLY be created by the owning active employee for their assigned company in valid company currency (`INR` only for MyGrade; `INR` or `AED` for TalentGrade) with `status == 'Pending'`, can only be edited/deleted while `Pending`, and can only be Approved/Rejected (with mandatory reason) or Marked Paid by Super Admin or an authorized non-self Team Leader in the same company.
10. Expense receipts (`mediaAssets` with `assetType == 'expense_receipt'`) are strictly private to the uploading employee, authorized reviewers, and Super Admin.
11. Asset assignment records (`assetAssignments/{assignmentId}`) maintain an immutable audit trail (no client deletes); employees may ONLY update acknowledgment fields once on their own active assignment, and company deactivation/exit never auto-unassigns or deletes assets.
12. Team Leaders / company-scoped managers are isolated to their assigned `companyId` for expenses and assets, while Super Admins oversee both TalentGrade and MyGrade.

## 2. The "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated read/write**: Reading `/employees/emp1` without `request.auth`.
2. **Self-Role Escalation on Employee update**: Employee updating `/employees/emp1` with `{ role: 'super_admin' }`.
3. **Self-Leave Balance Inflation**: Employee updating `/employees/emp1` with `{ sickLeaveBalance: 99 }`.
4. **Shadow Field Injection**: Creating `/leaveApplications/leave1` with an extra `{ isApprovedByHack: true }` field.
5. **Email Spoofing**: Authenticating with `email: 'enquiry.revivo@gmail.com'` when `email_verified: false`.
6. **Cross-Employee Salary Snooping**: Employee reading `/employeeSalaries/emp2`.
7. **Unpublished Payslip Snooping**: Employee reading `/payrollRecords/emp1_2026-11` when `status == 'Draft'`.
8. **Cross-Employee Attendance Photo Read**: Employee A reading `/attendancePhotos/empB_in`.
9. **Client Timestamp Forgery**: Creating `/attendanceRecords/emp1_2026-11-23` with `createdAt` in the past instead of `request.time`.
10. **ID Poisoning**: Creating `/departments/` with a 500-char ID or invalid characters (`dept/../admin`).
11. **Terminal State Bypass**: Employee modifying an already `Approved` `/leaveApplications/leave1` back to `Pending`.
12. **Audit Log Tampering**: Any user attempting `update` or `delete` on `/auditLogs/log1`.
13. **Birth Year / Full DOB Exposure**: Writing `dateOfBirth` into `/celebrationProfiles/{employeeId}` or updating another employee's `/employees/{id}` `dateOfBirth` without Super Admin role.
14. **Duplicate Annual Celebration Spam**: Creating `/celebrationNotifications/randomId` without matching deterministic `cel_{type}_{employeeId}_{year}` ID, or creating notifications for Inactive/Resigned/Terminated employees.
15. **Wish Impersonation / Unauthorized Moderation**: Creating `/celebrationWishes/{wishId}` with another user's `authorUid`, or deleting another employee's wish without Super Admin role.
16. **Regularization Cross-Employee Submission or Self-Approval**: Employee submitting `/attendanceCorrections/{id}` with another employee's `employeeUid`, or approving their own pending regularization request.
17. **Unauthorized Team Lead Queue Access / Duplicate Approval**: Team Leader without `canApproveCorrections` reading or approving another employee's regularization request, or re-approving an already `Approved`/`Rejected` request.
18. **Duplicate Unresolved Regularization Lock Bypass**: Submitting a second `/regularizationLocks/{employeeId}_{date}_{requestType}` while a `Pending` request already holds that deterministic lock.
19. **Cross-Employee Web Push Subscription Access**: Any user reading, listing, modifying, or deleting another employee's `/pushSubscriptions/{subId}` encryption keys or endpoint.
20. **Unauthorized Reminder Settings or Audit Modification**: Non-Super-Admin modifying `companySettings.attendanceReminders` or tampering with existing `/attendanceReminderLogs/{logId}` entries.
21. **Expense Self-Approval / Post-Approval Tampering**: Employee creating `/expenses/{id}` with `status: 'Approved'` or modifying `amount`/`status` on an `Approved`/`Paid` expense claim.
22. **MyGrade Multi-Currency Violation**: Submitting `/expenses/{id}` or `/assets/{id}` for `companyId: 'mygrade'` with `currency: 'AED'`.
23. **Cross-Employee Expense Receipt Snooping**: Employee A reading `/mediaAssets/{receiptId}` uploaded by Employee B with `assetType: 'expense_receipt'`.
24. **Cross-Company Admin Access**: A Team Leader assigned to `mygrade` reading, approving, or modifying `/expenses/{id}` or `/assets/{id}` belonging to `talentgrade`.
25. **Asset History Erasure / Unauthorized Return**: Any user deleting `/assetAssignments/{id}` or an employee modifying `returned: true` or `conditionOnAssign` on their assignment.

