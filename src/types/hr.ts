export type UserRole = 'super_admin' | 'team_leader' | 'employee';

export type EmployeeStatus = 'Active' | 'Inactive' | 'Resigned' | 'Terminated';

export type EmployeeLocation = 'India' | 'Dubai, UAE';

export type SalaryCurrency = 'INR' | 'AED';

export type AttendanceStatus =
  | 'Present'
  | 'Late'
  | 'Half Day'
  | 'Absent'
  | 'Leave'
  | 'Incomplete Attendance'
  | 'Holiday'
  | 'Weekly Off';

export type {
  LeaveType,
  LeavePolicyConfig,
  LeaveLedgerEntryType,
  LeaveLedgerSource,
  LeaveLedgerEntry,
  EmployeeLeaveComputedSummary,
} from '../../shared/leaveAccrualEngine';

export type {
  CelebrationType,
  CelebrationVisibilityScope,
  CelebrationSettings,
  ComputedCelebrationOccurrence,
} from '../../shared/celebrationEngine';

export {
  REGULARIZATION_TYPE_LABELS,
  REGULARIZATION_REQUEST_TYPES,
  type RegularizationRequestType,
  type RegularizedAttendanceStatus,
} from '../../shared/regularizationEngine';

export {
  DEFAULT_ATTENDANCE_REMINDER_SETTINGS,
  DEFAULT_EMPLOYEE_REMINDER_PREFERENCES,
  REMINDER_TYPE_LABELS,
  type AttendanceReminderLog,
  type AttendanceReminderSettings,
  type EmployeeReminderPreferences,
  type PushSubscriptionRecord,
  type PushSubscriptionStatus,
  type ReminderDeliveryStatus,
  type ReminderType,
} from '../../shared/attendanceReminderEngine';

export {
  COMPANY_IDS,
  DEFAULT_COMPANIES,
  DEFAULT_COMPANY_ADDRESS,
  assertCurrencyAllowedForCompany,
  enforceCompanyCurrency,
  getAllowedCurrenciesForCompany,
  getCompanyShortName,
  isCurrencyAllowedForCompany,
  isValidCompanyId,
  normalizeCompaniesMap,
  normalizeCompanyId,
  resolveCompanyProfile,
  type CompanyId,
  type CompanyIdentityOverride,
  type CompanyProfileConfig,
  type ResolvedCompanyIdentity,
  type SupportedCurrency,
} from '../../shared/companyConfig';

export {
  buildWorkingHoursAnalytics,
  computeStrictPunchDurationMinutes,
  formatMinutesAsHoursLabel,
  resolveAnalyticsDateRange,
  type BuildWorkingHoursAnalyticsInput,
  type DailyWorkingHoursPoint,
  type MonthlyWorkingHoursBucket,
  type WeeklyWorkingHoursBucket,
  type WorkingHoursAnalyticsResult,
  type WorkingHoursAnalyticsSummary,
  type WorkingHoursDayExtremum,
  type WorkingHoursRangePreset,
} from '../../shared/workingHoursEngine';

import type { CompanyId, CompanyProfileConfig, SupportedCurrency } from '../../shared/companyConfig';
import type { LeavePolicyConfig, LeaveType } from '../../shared/leaveAccrualEngine';
import type {
  CelebrationSettings,
  CelebrationType,
  CelebrationVisibilityScope,
} from '../../shared/celebrationEngine';
import type { RegularizationRequestType } from '../../shared/regularizationEngine';
import type {
  AttendanceReminderSettings,
  EmployeeReminderPreferences,
} from '../../shared/attendanceReminderEngine';

export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';

export type CorrectionStatus = 'Pending' | 'Approved' | 'Rejected';

export type PayrollStatus = 'Draft' | 'Finalized' | 'Published';

export interface HolidayItem {
  date: string; // YYYY-MM-DD
  name: string;
}

export interface TeamLeaderPermissions {
  canViewAllEmployees: boolean;
  canEditAttendance: boolean;
  canApproveCorrections: boolean;
  canApproveLeaves: boolean;
  canViewSalary: boolean;
  canApproveExpenses?: boolean;
  canManageAssets?: boolean;
}

export interface CompanySettings {
  companyName: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  taxId?: string;
  logoAssetId?: string;
  companies?: Partial<Record<CompanyId, CompanyProfileConfig>>;
  locations?: string[];
  supportedCurrencies?: string[];
  officeStartTime: string; // HH:mm
  officeEndTime: string;   // HH:mm
  gracePeriodMinutes: number;
  halfDayMinHours: number;
  fullDayMinHours: number;
  workingDays: number[]; // 0 = Sun ... 6 = Sat
  holidays?: HolidayItem[];
  defaultSickLeave: number;
  defaultCasualLeave: number;
  leavePolicy?: LeavePolicyConfig;
  celebrationSettings?: CelebrationSettings;
  attendanceReminders?: AttendanceReminderSettings;
  currency: string;
  teamLeaderPermissions: TeamLeaderPermissions;
  updatedAt?: unknown;
  updatedBy: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  managerUid?: string;
  createdAt?: unknown;
}

export interface Employee {
  id: string;
  uid: string;
  companyId?: CompanyId;
  employeeCode: string;
  fullName: string;
  email: string;
  phone?: string;
  emergencyContact?: string;
  role: UserRole;
  department: string;
  designation: string;
  joiningDate: string; // YYYY-MM-DD
  dateOfBirth?: string; // YYYY-MM-DD (restricted to Super Admin & owner only)
  birthdayMonthDay?: string; // MM-DD (privacy-safe)
  status: EmployeeStatus;
  location?: string;
  timezone?: string;
  currency?: string;
  // Optional per-employee working schedule overrides
  officeStartTime?: string;
  officeEndTime?: string;
  gracePeriodMinutes?: number;
  halfDayMinHours?: number;
  fullDayMinHours?: number;
  workingDays?: number[];
  managerUid?: string;
  profilePhotoAssetId?: string;
  sickLeaveBalance: number;
  casualLeaveBalance: number;
  carryForwardBalance: number;
  leavePolicyMigrated?: boolean;
  leaveBaselineMonth?: string; // YYYY-MM
  leaveLastSyncedMonth?: string; // YYYY-MM
  leaveLastResetYear?: number;
  clEligibilityDate?: string;    // YYYY-MM-DD
  clEligibilityCustom?: boolean;
  leaveMigrationNote?: string;
  reminderPreferences?: EmployeeReminderPreferences;
  mustChangePassword: boolean;
  failedLoginAttempts: number;
  lockedUntil?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SalaryLineItem {
  label: string;
  amount: number;
}

export interface EmployeeSalary {
  id: string;
  employeeId: string;
  employeeUid: string;
  currency?: string;
  basicSalary: number;
  hra: number;
  otherEarnings: SalaryLineItem[];
  deductions: SalaryLineItem[];
  professionalTax: number;
  defaultBonus: number;
  netSalary: number;
  updatedAt?: unknown;
  updatedBy: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  department: string;
  managerUid?: string;
  date: string; // YYYY-MM-DD
  timezone?: string;
  punchInTime?: string; // ISO string
  punchInLat?: number;
  punchInLng?: number;
  punchInAccuracy?: number;
  punchInPhotoId?: string;
  punchOutTime?: string; // ISO string
  punchOutLat?: number;
  punchOutLng?: number;
  punchOutAccuracy?: number;
  punchOutPhotoId?: string;
  workingMinutes: number;
  status: AttendanceStatus;
  isLate: boolean;
  lateByMinutes: number;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AttendancePhoto {
  id: string;
  employeeId: string;
  employeeUid: string;
  managerUid?: string;
  attendanceRecordId: string;
  punchType: 'in' | 'out';
  date: string;
  capturedAt?: unknown;
  mimeType: string;
  dataUrl: string;
}

export interface MediaAsset {
  id: string;
  ownerUid: string;
  assetType: 'company_logo' | 'profile_photo' | 'attachment' | 'expense_receipt' | 'asset_photo';
  fileName: string;
  mimeType: string;
  dataUrl: string;
  createdAt?: unknown;
}

export interface RegularizationAppliedChanges {
  punchInTime?: string;
  punchOutTime?: string;
  workingMinutes: number;
  status: AttendanceStatus;
  isLate: boolean;
  lateByMinutes: number;
}

export interface AttendanceCorrection {
  id: string;
  employeeId: string;
  employeeUid: string;
  employeeCode?: string;
  employeeName: string;
  department: string;
  managerUid?: string;
  date: string;
  timezone?: string;
  attendanceRecordId: string;
  requestType?: RegularizationRequestType;
  requestedPunchIn: string;
  requestedPunchOut: string;
  originalPunchInTime?: string;
  originalPunchOutTime?: string;
  originalStatus?: AttendanceStatus;
  originalWorkingMinutes?: number;
  reason: string;
  attachmentAssetId?: string;
  status: CorrectionStatus;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedByRole?: UserRole;
  reviewComment?: string;
  appliedChanges?: RegularizationAppliedChanges;
  submittedAtIso?: string;
  reviewedAt?: unknown;
  createdAt?: unknown;
}

export type HrNotificationEventType =
  | 'submitted_confirmation'
  | 'submitted_admin'
  | 'approved'
  | 'rejected';

export interface HrNotification {
  id: string;
  category: 'regularization';
  eventType: HrNotificationEventType;
  audienceType: 'user' | 'reviewers';
  targetUid?: string;
  requestId: string;
  employeeId: string;
  employeeCode?: string;
  employeeName: string;
  department: string;
  attendanceDate: string;
  requestType: RegularizationRequestType;
  title: string;
  message: string;
  note?: string;
  actorUid: string;
  actorName: string;
  createdAt?: unknown;
}

export interface LeaveApplication {
  id: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  department: string;
  managerUid?: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  attachmentAssetId?: string;
  status: LeaveStatus;
  balanceDeducted: boolean;
  deductedAmount: number;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewComment?: string;
  reviewedAt?: unknown;
  createdAt?: unknown;
}

export interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  department: string;
  companyId?: CompanyId;
  companyName?: string;
  companyAddress?: string;
  companyLogoAssetId?: string;
  companyOverridden?: boolean;
  generatedAtIso?: string;
  location?: string;
  currency?: string;
  month: string; // YYYY-MM
  basicSalary: number;
  hra: number;
  otherEarnings: SalaryLineItem[];
  bonus: number;
  deductions: SalaryLineItem[];
  professionalTax: number;
  grossEarnings: number;
  totalDeductions: number;
  netSalary: number;
  workingDaysInMonth: number;
  presentDays: number;
  leaveDays: number;
  status: PayrollStatus;
  notes?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  publishedAt?: unknown;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  previousValues?: Record<string, unknown>;
  updatedValues?: Record<string, unknown>;
  summary: string;
  createdAt?: unknown;
}

export interface CelebrationProfile {
  id: string;
  employeeId: string;
  employeeUid: string;
  fullName: string;
  department: string;
  designation: string;
  location: string;
  status: EmployeeStatus;
  role: UserRole;
  profilePhotoAssetId?: string;
  birthdayMonthDay?: string; // MM-DD only (never birth year)
  joiningDate: string; // YYYY-MM-DD
  updatedAt?: unknown;
}

export interface CelebrationNotification {
  id: string;
  type: CelebrationType;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  department: string;
  designation: string;
  profilePhotoAssetId?: string;
  celebrationDate: string; // YYYY-MM-DD
  celebrationMonthDay: string; // MM-DD
  year: number;
  yearsCompleted?: number;
  title: string;
  message: string;
  audienceScope: CelebrationVisibilityScope;
  createdByUid: string;
  createdAt?: unknown;
}

export interface NotificationReadReceipt {
  id: string;
  uid: string;
  notificationId: string;
  readAt?: unknown;
}

export interface CelebrationWish {
  id: string;
  notificationId: string;
  type: CelebrationType;
  recipientEmployeeId: string;
  recipientName: string;
  authorUid: string;
  authorEmployeeId: string;
  authorName: string;
  authorDepartment: string;
  authorPhotoAssetId?: string;
  emoji: string;
  message: string;
  createdAt?: unknown;
}

export const EXPENSE_CATEGORIES = [
  'Travel',
  'Food / Meals',
  'Internet',
  'Fuel',
  'Accommodation',
  'Office expenses',
  'Medical expenses',
  'Other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type ExpenseStatus = 'Pending' | 'Approved' | 'Rejected' | 'Paid';

export interface ExpenseClaim {
  id: string;
  employeeId: string;
  employeeUid: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  managerUid?: string;
  companyId: CompanyId;
  category: ExpenseCategory;
  amount: number;
  currency: SupportedCurrency;
  expenseDate: string; // YYYY-MM-DD
  description: string;
  notes?: string;
  receiptAssetId: string;
  receiptFileName?: string;
  receiptMimeType?: string;
  status: ExpenseStatus;
  reviewedByUid?: string;
  reviewedByName?: string;
  reviewedAtIso?: string;
  reviewedAt?: unknown;
  approvalNote?: string;
  rejectionReason?: string;
  paidByUid?: string;
  paidByName?: string;
  paidAtIso?: string;
  paidAt?: unknown;
  paymentReference?: string;
  paymentNote?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export const ASSET_CATEGORIES = [
  'Laptop',
  'Desktop',
  'Mobile phone',
  'SIM card',
  'Headset',
  'Monitor',
  'Keyboard',
  'Mouse',
  'ID card',
  'Access card',
  'Office equipment',
  'Other',
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_STATUSES = [
  'Available',
  'Assigned',
  'Under repair',
  'Lost',
  'Retired',
] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_CONDITIONS = [
  'New',
  'Good',
  'Fair',
  'Damaged',
  'Needs Repair',
] as const;

export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

export interface CompanyAsset {
  id: string;
  assetTag: string;
  name: string;
  category: AssetCategory;
  brand?: string;
  model?: string;
  serialNumber?: string;
  purchaseDate?: string;
  purchaseCost?: number;
  currency?: SupportedCurrency;
  warrantyExpiry?: string;
  condition: AssetCondition;
  status: AssetStatus;
  companyId: CompanyId;
  notes?: string;
  photoAssetId?: string;
  currentAssignmentId?: string;
  assignedToEmployeeId?: string;
  assignedToEmployeeUid?: string;
  assignedToEmployeeName?: string;
  assignedAtIso?: string;
  createdByUid: string;
  createdByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AssetAssignment {
  id: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  assetCategory: AssetCategory;
  serialNumber?: string;
  photoAssetId?: string;
  companyId: CompanyId;
  employeeId: string;
  employeeUid: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  managerUid?: string;
  assignedDate: string; // YYYY-MM-DD
  assignedByUid: string;
  assignedByName: string;
  conditionOnAssign: AssetCondition;
  assignRemarks?: string;
  acknowledged: boolean;
  acknowledgedByUid?: string;
  acknowledgedByName?: string;
  acknowledgedAtIso?: string;
  acknowledgedAt?: unknown;
  acknowledgmentStatement?: string;
  returned: boolean;
  returnDate?: string;
  returnCondition?: AssetCondition;
  returnRemarks?: string;
  returnedByAdminUid?: string;
  returnedByAdminName?: string;
  returnedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type AppPage =
  | 'dashboard'
  | 'attendance'
  | 'leaves'
  | 'expenses'
  | 'assets'
  | 'employees'
  | 'payroll'
  | 'celebrations'
  | 'reports'
  | 'settings';
