import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import {
  AttendanceCorrection,
  AttendanceRecord,
  AttendanceStatus,
  CompanySettings,
  Employee,
  HrNotification,
  RegularizationAppliedChanges,
  RegularizationRequestType,
} from '../types/hr';
import { cleanObject, getEffectiveSchedule, makeSafeId, writeAuditLog } from './hrService';
import {
  computeRegularizedAttendanceMetrics,
  getLocalTodayForTimezone,
  makeRegularizationLockId,
  REGULARIZATION_TYPE_LABELS,
  validateRegularizationPayload,
} from '../../shared/regularizationEngine';

function timestampToMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'string') {
    const ms = new Date(ts).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof ts === 'object' && ts !== null) {
    const maybe = ts as { toMillis?: () => number; seconds?: number };
    if (typeof maybe.toMillis === 'function') return maybe.toMillis();
    if (typeof maybe.seconds === 'number') return maybe.seconds * 1000;
  }
  return 0;
}

async function fetchWithAuthRetry(url: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');

  const send = async (forceRefresh: boolean) => {
    const token = await user.getIdToken(forceRefresh);
    return fetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
  };

  let res = await send(false);
  if (res.status === 401) {
    res = await send(true);
  }
  return res;
}

async function extractJsonError(res: Response, fallback: string): Promise<string> {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const errBody = await res.json().catch(() => null);
    if (errBody && typeof errBody.error === 'string' && errBody.error.trim()) {
      return errBody.error;
    }
  }
  return fallback;
}

export async function fetchAttendanceRegularizations(
  employee: Employee,
  canApproveCorrections: boolean
): Promise<AttendanceCorrection[]> {
  try {
    const isReviewer = employee.role === 'super_admin' || canApproveCorrections;
    const q = isReviewer
      ? query(collection(db, 'attendanceCorrections'), orderBy('createdAt', 'desc'), limit(300))
      : query(collection(db, 'attendanceCorrections'), where('employeeUid', '==', employee.uid));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<AttendanceCorrection, 'id'>) }))
      .sort((a, b) => {
        const diff = timestampToMs(b.createdAt) - timestampToMs(a.createdAt);
        return diff !== 0 ? diff : b.date.localeCompare(a.date);
      });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'attendanceCorrections');
  }
}

export async function submitAttendanceRegularization(params: {
  employee: Employee;
  settings: CompanySettings;
  date: string;
  requestType: RegularizationRequestType;
  requestedPunchIn: string;
  requestedPunchOut: string;
  reason: string;
  attachmentAssetId?: string;
}): Promise<AttendanceCorrection> {
  const schedule = getEffectiveSchedule(params.employee, params.settings);
  const timezone = schedule.timezone;

  // 1. Authoritative server-side validation (server clock + employee timezone)
  let serverTimeIso = new Date().toISOString();
  let normalizedPunchIn = params.requestedPunchIn.trim();
  let normalizedPunchOut = params.requestedPunchOut.trim();
  let normalizedReason = params.reason.trim();

  const valRes = await fetchWithAuthRetry('/api/attendance/regularization/validate', {
    method: 'POST',
    body: JSON.stringify({
      date: params.date,
      requestType: params.requestType,
      requestedPunchIn: normalizedPunchIn,
      requestedPunchOut: normalizedPunchOut,
      reason: normalizedReason,
      timezone,
    }),
  });

  if (!valRes.ok) {
    throw new Error(
      await extractJsonError(valRes, `Attendance regularization validation failed (HTTP ${valRes.status}).`)
    );
  }

  const valData = await valRes.json();
  serverTimeIso = valData.serverTimeIso || serverTimeIso;
  normalizedPunchIn = valData.normalizedPunchIn ?? normalizedPunchIn;
  normalizedPunchOut = valData.normalizedPunchOut ?? normalizedPunchOut;
  normalizedReason = valData.normalizedReason ?? normalizedReason;

  // Secondary defensive client validation
  const clientCheck = validateRegularizationPayload({
    date: params.date,
    todayInTimezone: valData.todayDate || getLocalTodayForTimezone(timezone),
    requestType: params.requestType,
    requestedPunchIn: normalizedPunchIn,
    requestedPunchOut: normalizedPunchOut,
    reason: normalizedReason,
  });
  if (!clientCheck.valid) {
    throw new Error(clientCheck.error || 'Invalid attendance regularization request.');
  }

  const recordId = `${params.employee.id}_${params.date}`.replace(/[^a-zA-Z0-9_-]/g, '');
  const lockId = makeRegularizationLockId(params.employee.id, params.date, params.requestType);
  const corrId = makeSafeId('reg');

  // 2. Capture existing attendance record snapshot & verify combined times don't invert
  const existingRecSnap = await getDoc(doc(db, 'attendanceRecords', recordId));
  const existingRec = existingRecSnap.exists()
    ? ({ id: existingRecSnap.id, ...(existingRecSnap.data() as Omit<AttendanceRecord, 'id'>) } as AttendanceRecord)
    : null;

  if (existingRec) {
    computeRegularizedAttendanceMetrics({
      date: params.date,
      timeZone: timezone,
      requestedPunchIn: normalizedPunchIn,
      requestedPunchOut: normalizedPunchOut,
      existingPunchInIso: existingRec.punchInTime,
      existingPunchOutIso: existingRec.punchOutTime,
      schedule,
    });
  }

  try {
    // 3. Atomic transaction: enforce duplicate unresolved prevention lock + persist request
    await runTransaction(db, async (tx) => {
      const lockRef = doc(db, 'regularizationLocks', lockId);
      const lockSnap = await tx.get(lockRef);

      if (lockSnap.exists()) {
        const existingCorrId = String(lockSnap.data().correctionId || '');
        if (existingCorrId) {
          const existingCorrSnap = await tx.get(doc(db, 'attendanceCorrections', existingCorrId));
          if (existingCorrSnap.exists() && existingCorrSnap.data().status === 'Pending') {
            throw new Error(
              `You already have a pending ${REGULARIZATION_TYPE_LABELS[params.requestType]} request for ${params.date}.`
            );
          }
        }
      }

      const corrRef = doc(db, 'attendanceCorrections', corrId);
      tx.set(
        corrRef,
        cleanObject({
          employeeId: params.employee.id,
          employeeUid: params.employee.uid,
          employeeCode: params.employee.employeeCode,
          employeeName: params.employee.fullName,
          department: params.employee.department,
          managerUid: params.employee.managerUid,
          date: params.date,
          timezone,
          attendanceRecordId: recordId,
          requestType: params.requestType,
          requestedPunchIn: normalizedPunchIn,
          requestedPunchOut: normalizedPunchOut,
          originalPunchInTime: existingRec?.punchInTime || undefined,
          originalPunchOutTime: existingRec?.punchOutTime || undefined,
          originalStatus: existingRec?.status || undefined,
          originalWorkingMinutes:
            typeof existingRec?.workingMinutes === 'number' ? existingRec.workingMinutes : undefined,
          reason: normalizedReason,
          attachmentAssetId: params.attachmentAssetId || undefined,
          status: 'Pending',
          submittedAtIso: serverTimeIso,
          createdAt: serverTimestamp(),
        })
      );

      tx.set(lockRef, {
        employeeId: params.employee.id,
        employeeUid: params.employee.uid,
        date: params.date,
        requestType: params.requestType,
        correctionId: corrId,
        createdAt: serverTimestamp(),
      });
    });

    const typeLabel = REGULARIZATION_TYPE_LABELS[params.requestType];
    const actorUid = auth.currentUser?.uid || params.employee.uid;

    // 4. Create confirmation notification for employee & alert notification for reviewers
    const confirmId = makeSafeId('hrn_sub');
    const adminNotifId = makeSafeId('hrn_rev');
    await Promise.all([
      setDoc(
        doc(db, 'hrNotifications', confirmId),
        cleanObject({
          category: 'regularization',
          eventType: 'submitted_confirmation',
          audienceType: 'user',
          targetUid: params.employee.uid,
          requestId: corrId,
          employeeId: params.employee.id,
          employeeCode: params.employee.employeeCode,
          employeeName: params.employee.fullName,
          department: params.employee.department,
          attendanceDate: params.date,
          requestType: params.requestType,
          title: 'Attendance Regularization Submitted',
          message: `Your ${typeLabel} request for ${params.date} is pending review.`,
          actorUid,
          actorName: params.employee.fullName,
          createdAt: serverTimestamp(),
        })
      ),
      setDoc(
        doc(db, 'hrNotifications', adminNotifId),
        cleanObject({
          category: 'regularization',
          eventType: 'submitted_admin',
          audienceType: 'reviewers',
          requestId: corrId,
          employeeId: params.employee.id,
          employeeCode: params.employee.employeeCode,
          employeeName: params.employee.fullName,
          department: params.employee.department,
          attendanceDate: params.date,
          requestType: params.requestType,
          title: 'New Attendance Regularization Request',
          message: `${params.employee.fullName} (${params.employee.employeeCode}) submitted a ${typeLabel} request for ${params.date}.`,
          actorUid,
          actorName: params.employee.fullName,
          createdAt: serverTimestamp(),
        })
      ),
      writeAuditLog({
        actor: params.employee,
        action: 'REGULARIZATION_SUBMITTED',
        entityType: 'AttendanceRegularization',
        entityId: corrId,
        previousValues: existingRec
          ? {
              date: params.date,
              originalPunchInTime: existingRec.punchInTime || '',
              originalPunchOutTime: existingRec.punchOutTime || '',
              originalStatus: existingRec.status,
              originalWorkingMinutes: existingRec.workingMinutes,
            }
          : { date: params.date, originalStatus: 'None' },
        updatedValues: {
          requestType: params.requestType,
          requestedPunchIn: normalizedPunchIn,
          requestedPunchOut: normalizedPunchOut,
          status: 'Pending',
        },
        summary: `${params.employee.fullName} submitted ${typeLabel} regularization for ${params.date}.`,
      }),
    ]);

    return {
      id: corrId,
      employeeId: params.employee.id,
      employeeUid: params.employee.uid,
      employeeCode: params.employee.employeeCode,
      employeeName: params.employee.fullName,
      department: params.employee.department,
      managerUid: params.employee.managerUid,
      date: params.date,
      timezone,
      attendanceRecordId: recordId,
      requestType: params.requestType,
      requestedPunchIn: normalizedPunchIn,
      requestedPunchOut: normalizedPunchOut,
      originalPunchInTime: existingRec?.punchInTime,
      originalPunchOutTime: existingRec?.punchOutTime,
      originalStatus: existingRec?.status,
      originalWorkingMinutes: existingRec?.workingMinutes,
      reason: normalizedReason,
      attachmentAssetId: params.attachmentAssetId,
      status: 'Pending',
      submittedAtIso: serverTimeIso,
      createdAt: serverTimeIso,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes('already have a pending')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.CREATE, `attendanceCorrections/${corrId}`);
  }
}

export async function reviewAttendanceRegularization(params: {
  request: AttendanceCorrection;
  decision: 'Approved' | 'Rejected';
  comment: string;
  actor: Employee;
  settings: CompanySettings;
}): Promise<void> {
  const canApprove =
    params.actor.role === 'super_admin' ||
    (params.actor.role === 'team_leader' && params.settings.teamLeaderPermissions.canApproveCorrections);
  if (!canApprove) {
    throw new Error('You do not have permission to approve or reject attendance regularization requests.');
  }

  if (params.actor.role !== 'super_admin' && params.request.employeeUid === params.actor.uid) {
    throw new Error('You cannot approve or reject your own attendance regularization request.');
  }

  const trimmedComment = params.comment.trim().slice(0, 500);
  const reqType: RegularizationRequestType = params.request.requestType || 'incorrect_punch';

  // Fetch target employee to honor per-employee timezone & schedule overrides
  const empSnap = await getDoc(doc(db, 'employees', params.request.employeeId));
  const targetEmp = empSnap.exists()
    ? ({ id: empSnap.id, ...(empSnap.data() as Omit<Employee, 'id'>) } as Employee)
    : null;
  const targetSchedule = targetEmp
    ? getEffectiveSchedule(targetEmp, params.settings)
    : {
        location: 'India',
        timezone: params.request.timezone || 'Asia/Kolkata',
        currency: params.settings.currency || 'INR',
        officeStartTime: params.settings.officeStartTime || '09:30',
        officeEndTime: params.settings.officeEndTime || '18:30',
        gracePeriodMinutes: params.settings.gracePeriodMinutes ?? 15,
        halfDayMinHours: params.settings.halfDayMinHours ?? 4,
        fullDayMinHours: params.settings.fullDayMinHours ?? 8,
        workingDays: params.settings.workingDays || [1, 2, 3, 4, 5],
      };

  const lockId = makeRegularizationLockId(
    params.request.employeeId,
    params.request.date,
    reqType
  );

  // If approving, validate & compute authoritative metrics via backend endpoint first
  let serverComputed: RegularizationAppliedChanges | undefined;
  if (params.decision === 'Approved') {
    const preRecSnap = await getDoc(doc(db, 'attendanceRecords', params.request.attendanceRecordId));
    const preRec = preRecSnap.exists() ? (preRecSnap.data() as AttendanceRecord) : null;
    const res = await fetchWithAuthRetry('/api/attendance/regularization/compute-approval', {
      method: 'POST',
      body: JSON.stringify({
        date: params.request.date,
        timezone: preRec?.timezone || params.request.timezone || targetSchedule.timezone,
        requestedPunchIn: params.request.requestedPunchIn,
        requestedPunchOut: params.request.requestedPunchOut,
        existingPunchInIso: preRec?.punchInTime,
        existingPunchOutIso: preRec?.punchOutTime,
        schedule: targetSchedule,
      }),
    });
    if (!res.ok) {
      throw new Error(
        await extractJsonError(res, `Could not compute regularized attendance metrics (HTTP ${res.status}).`)
      );
    }
    const data = await res.json();
    serverComputed = {
      punchInTime: data.computed.punchInTime,
      punchOutTime: data.computed.punchOutTime,
      workingMinutes: data.computed.workingMinutes,
      status: data.computed.status as AttendanceStatus,
      isLate: Boolean(data.computed.isLate),
      lateByMinutes: Number(data.computed.lateByMinutes || 0),
    };
  }

  let beforeSnapshot: Record<string, unknown> = { status: 'Pending' };
  let appliedSnapshot: RegularizationAppliedChanges | undefined;

  try {
    await runTransaction(db, async (tx) => {
      const corrRef = doc(db, 'attendanceCorrections', params.request.id);
      const corrSnap = await tx.get(corrRef);
      if (!corrSnap.exists()) {
        throw new Error('Attendance regularization request not found.');
      }
      const corrData = corrSnap.data() as AttendanceCorrection;
      if (corrData.status !== 'Pending') {
        throw new Error('This attendance regularization request has already been reviewed.');
      }

      const recRef = doc(db, 'attendanceRecords', corrData.attendanceRecordId);
      const recSnap = await tx.get(recRef);
      const lockRef = doc(db, 'regularizationLocks', lockId);
      const lockSnap = await tx.get(lockRef);

      const prevRec = recSnap.exists() ? (recSnap.data() as AttendanceRecord) : null;
      const effectiveTz = prevRec?.timezone || corrData.timezone || targetSchedule.timezone;

      beforeSnapshot = prevRec
        ? {
            requestStatus: corrData.status,
            originalPunchInTime: prevRec.punchInTime || '',
            originalPunchOutTime: prevRec.punchOutTime || '',
            originalStatus: prevRec.status,
            originalWorkingMinutes: prevRec.workingMinutes,
          }
        : {
            requestStatus: corrData.status,
            originalStatus: 'None',
          };

      if (params.decision === 'Approved') {
        const computed = computeRegularizedAttendanceMetrics({
          date: corrData.date,
          timeZone: effectiveTz,
          requestedPunchIn: corrData.requestedPunchIn,
          requestedPunchOut: corrData.requestedPunchOut,
          existingPunchInIso: prevRec?.punchInTime,
          existingPunchOutIso: prevRec?.punchOutTime,
          schedule: targetSchedule,
        });

        appliedSnapshot = {
          punchInTime: serverComputed?.punchInTime ?? computed.punchInTime,
          punchOutTime: serverComputed?.punchOutTime ?? computed.punchOutTime,
          workingMinutes: serverComputed?.workingMinutes ?? computed.workingMinutes,
          status: (serverComputed?.status ?? computed.status) as AttendanceStatus,
          isLate: serverComputed?.isLate ?? computed.isLate,
          lateByMinutes: serverComputed?.lateByMinutes ?? computed.lateByMinutes,
        };

        tx.set(
          recRef,
          cleanObject({
            employeeId: corrData.employeeId,
            employeeUid: corrData.employeeUid,
            employeeName: corrData.employeeName,
            department: corrData.department,
            managerUid: corrData.managerUid || targetEmp?.managerUid,
            date: corrData.date,
            timezone: effectiveTz,
            punchInTime: appliedSnapshot.punchInTime,
            punchInLat: prevRec?.punchInLat,
            punchInLng: prevRec?.punchInLng,
            punchInAccuracy: prevRec?.punchInAccuracy,
            punchInPhotoId: prevRec?.punchInPhotoId,
            punchOutTime: appliedSnapshot.punchOutTime,
            punchOutLat: prevRec?.punchOutLat,
            punchOutLng: prevRec?.punchOutLng,
            punchOutAccuracy: prevRec?.punchOutAccuracy,
            punchOutPhotoId: prevRec?.punchOutPhotoId,
            workingMinutes: appliedSnapshot.workingMinutes,
            status: appliedSnapshot.status,
            isLate: appliedSnapshot.isLate,
            lateByMinutes: appliedSnapshot.lateByMinutes,
            notes: `Regularized (${REGULARIZATION_TYPE_LABELS[reqType]}): ${trimmedComment || corrData.reason}`.slice(0, 500),
            createdAt: prevRec?.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }

      tx.update(
        corrRef,
        cleanObject({
          status: params.decision,
          reviewedBy: params.actor.uid,
          reviewedByName: params.actor.fullName,
          reviewedByRole: params.actor.role,
          reviewComment: trimmedComment,
          appliedChanges: appliedSnapshot ? cleanObject({ ...appliedSnapshot }) : undefined,
          reviewedAt: serverTimestamp(),
        })
      );

      if (lockSnap.exists() && String(lockSnap.data().correctionId || '') === params.request.id) {
        tx.delete(lockRef);
      }
    });

    const typeLabel = REGULARIZATION_TYPE_LABELS[reqType];
    const actorUid = auth.currentUser?.uid || params.actor.uid;

    // Persist audit log & employee notification in parallel
    await Promise.all([
      writeAuditLog({
        actor: params.actor,
        action: `REGULARIZATION_${params.decision.toUpperCase()}`,
        entityType: 'AttendanceRegularization',
        entityId: params.request.id,
        previousValues: beforeSnapshot,
        updatedValues: cleanObject({
          status: params.decision,
          requestType: reqType,
          requestedPunchIn: params.request.requestedPunchIn,
          requestedPunchOut: params.request.requestedPunchOut,
          reviewComment: trimmedComment,
          reviewedBy: params.actor.uid,
          reviewedByName: params.actor.fullName,
          appliedChanges: appliedSnapshot ? cleanObject({ ...appliedSnapshot }) : undefined,
        }),
        summary: `${params.actor.fullName} ${params.decision.toLowerCase()} ${typeLabel} regularization for ${params.request.employeeName} (${params.request.date}).`,
      }),
      setDoc(
        doc(db, 'hrNotifications', makeSafeId('hrn_dec')),
        cleanObject({
          category: 'regularization',
          eventType: params.decision === 'Approved' ? 'approved' : 'rejected',
          audienceType: 'user',
          targetUid: params.request.employeeUid,
          requestId: params.request.id,
          employeeId: params.request.employeeId,
          employeeCode: params.request.employeeCode,
          employeeName: params.request.employeeName,
          department: params.request.department,
          attendanceDate: params.request.date,
          requestType: reqType,
          title:
            params.decision === 'Approved'
              ? 'Attendance Regularization Approved'
              : 'Attendance Regularization Rejected',
          message:
            params.decision === 'Approved'
              ? `Your ${typeLabel} request for ${params.request.date} was approved by ${params.actor.fullName}.`
              : `Your ${typeLabel} request for ${params.request.date} was rejected by ${params.actor.fullName}.`,
          note: trimmedComment || undefined,
          actorUid,
          actorName: params.actor.fullName,
          createdAt: serverTimestamp(),
        })
      ),
    ]);
  } catch (err) {
    if (err instanceof Error && (err.message.includes('already been reviewed') || err.message.includes('not found'))) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `attendanceCorrections/${params.request.id}`);
  }
}

export async function fetchHrNotifications(
  employee: Employee,
  canApproveCorrections: boolean
): Promise<HrNotification[]> {
  try {
    const queries = [
      query(collection(db, 'hrNotifications'), where('targetUid', '==', employee.uid)),
    ];
    if (employee.role === 'super_admin' || canApproveCorrections) {
      queries.push(
        query(collection(db, 'hrNotifications'), where('audienceType', '==', 'reviewers'))
      );
    }
    const snaps = await Promise.all(queries.map((q) => getDocs(q)));
    const map = new Map<string, HrNotification>();
    for (const snap of snaps) {
      for (const d of snap.docs) {
        map.set(d.id, { id: d.id, ...(d.data() as Omit<HrNotification, 'id'>) });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt)
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'hrNotifications');
  }
}
