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

import type { LeavePolicyConfig, LeaveType } from '../../shared/leaveAccrualEngine';

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
}

export interface CompanySettings {
  companyName: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  taxId?: string;
  logoAssetId?: string;
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
  employeeCode: string;
  fullName: string;
  email: string;
  phone?: string;
  emergencyContact?: string;
  role: UserRole;
  department: string;
  designation: string;
  joiningDate: string; // YYYY-MM-DD
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
  leaveLastSyncedMonth?: string; // YYYY-MM
  leaveLastResetYear?: number;
  clEligibilityDate?: string;    // YYYY-MM-DD
  leaveMigrationNote?: string;
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
  assetType: 'company_logo' | 'profile_photo' | 'attachment';
  fileName: string;
  mimeType: string;
  dataUrl: string;
  createdAt?: unknown;
}

export interface AttendanceCorrection {
  id: string;
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  department: string;
  managerUid?: string;
  date: string;
  attendanceRecordId: string;
  requestedPunchIn: string;
  requestedPunchOut: string;
  reason: string;
  attachmentAssetId?: string;
  status: CorrectionStatus;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewComment?: string;
  reviewedAt?: unknown;
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

export type AppPage =
  | 'dashboard'
  | 'attendance'
  | 'leaves'
  | 'employees'
  | 'payroll'
  | 'reports'
  | 'settings';
