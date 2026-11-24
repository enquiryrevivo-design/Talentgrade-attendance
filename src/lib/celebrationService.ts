import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import {
  CelebrationNotification,
  CelebrationProfile,
  CelebrationSettings,
  CelebrationWish,
  CompanySettings,
  ComputedCelebrationOccurrence,
  Employee,
} from '../types/hr';
import { cleanObject, fetchMediaAsset, makeSafeId, writeAuditLog } from './hrService';
import {
  DEFAULT_CELEBRATION_SETTINGS,
  evaluateCelebrationsWindow,
  extractMonthDayFromDate,
  makeCelebrationNotificationId,
  normalizeCelebrationSettings,
} from '../../shared/celebrationEngine';

export const CELEBRATION_EMOJI_OPTIONS = ['🎉', '🎂', '👏', '🌟', '💐', '🏆'] as const;

export function buildCelebrationProfilePayload(emp: Employee) {
  const birthdayMonthDay = emp.birthdayMonthDay || extractMonthDayFromDate(emp.dateOfBirth);
  return cleanObject({
    employeeId: emp.id,
    employeeUid: emp.uid || '',
    fullName: emp.fullName,
    department: emp.department,
    designation: emp.designation,
    location: emp.location || 'India',
    status: emp.status,
    role: emp.role,
    profilePhotoAssetId: emp.profilePhotoAssetId || undefined,
    birthdayMonthDay: birthdayMonthDay || undefined,
    joiningDate: emp.joiningDate,
    updatedAt: serverTimestamp(),
  });
}

export async function ensureOwnCelebrationProfile(emp: Employee): Promise<void> {
  try {
    const ref = doc(db, 'celebrationProfiles', emp.id);
    const snap = await getDoc(ref);
    const desiredMd = emp.birthdayMonthDay || extractMonthDayFromDate(emp.dateOfBirth);
    if (!snap.exists()) {
      await setDoc(ref, buildCelebrationProfilePayload(emp));
      return;
    }
    const cur = snap.data() as CelebrationProfile;
    if (
      cur.employeeUid !== (emp.uid || '') ||
      cur.fullName !== emp.fullName ||
      cur.department !== emp.department ||
      cur.designation !== emp.designation ||
      cur.status !== emp.status ||
      (cur.profilePhotoAssetId || '') !== (emp.profilePhotoAssetId || '') ||
      (cur.birthdayMonthDay || '') !== (desiredMd || '') ||
      cur.joiningDate !== emp.joiningDate
    ) {
      await setDoc(ref, buildCelebrationProfilePayload(emp));
    }
  } catch (err) {
    console.warn('Could not ensure own celebration profile:', err);
  }
}

export async function syncAllCelebrationProfilesFromEmployees(
  actor: Employee,
  employees: Employee[]
): Promise<number> {
  if (actor.role !== 'super_admin') return 0;
  let synced = 0;
  try {
    const existingSnap = await getDocs(collection(db, 'celebrationProfiles'));
    const existingMap = new Map<string, CelebrationProfile>();
    for (const d of existingSnap.docs) {
      existingMap.set(d.id, { id: d.id, ...(d.data() as Omit<CelebrationProfile, 'id'>) });
    }

    for (const emp of employees) {
      const cur = existingMap.get(emp.id);
      const desiredMd = emp.birthdayMonthDay || extractMonthDayFromDate(emp.dateOfBirth);
      const needsSync =
        !cur ||
        cur.employeeUid !== (emp.uid || '') ||
        cur.fullName !== emp.fullName ||
        cur.department !== emp.department ||
        cur.designation !== emp.designation ||
        cur.location !== (emp.location || 'India') ||
        cur.status !== emp.status ||
        cur.role !== emp.role ||
        (cur.profilePhotoAssetId || '') !== (emp.profilePhotoAssetId || '') ||
        (cur.birthdayMonthDay || '') !== (desiredMd || '') ||
        cur.joiningDate !== emp.joiningDate;

      if (needsSync) {
        await setDoc(doc(db, 'celebrationProfiles', emp.id), buildCelebrationProfilePayload(emp));
        synced += 1;
      }
    }
  } catch (err) {
    console.warn('Could not sync celebration profiles:', err);
  }
  return synced;
}

export async function fetchCelebrationProfiles(): Promise<CelebrationProfile[]> {
  try {
    const snap = await getDocs(collection(db, 'celebrationProfiles'));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<CelebrationProfile, 'id'>) }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'celebrationProfiles');
  }
}

export async function fetchCelebrationNotifications(
  currentEmployee: Employee
): Promise<CelebrationNotification[]> {
  try {
    const results = new Map<string, CelebrationNotification>();

    if (currentEmployee.role === 'super_admin') {
      const snap = await getDocs(
        query(collection(db, 'celebrationNotifications'), orderBy('celebrationDate', 'desc'), limit(200))
      );
      for (const d of snap.docs) {
        results.set(d.id, { id: d.id, ...(d.data() as Omit<CelebrationNotification, 'id'>) });
      }
    } else {
      const queries = [
        query(
          collection(db, 'celebrationNotifications'),
          where('audienceScope', '==', 'all_active')
        ),
        query(
          collection(db, 'celebrationNotifications'),
          where('employeeUid', '==', currentEmployee.uid)
        ),
        query(
          collection(db, 'celebrationNotifications'),
          where('audienceScope', '==', 'department'),
          where('department', '==', currentEmployee.department)
        ),
      ];
      if (currentEmployee.role === 'team_leader') {
        queries.push(
          query(
            collection(db, 'celebrationNotifications'),
            where('audienceScope', '==', 'leaders_only')
          )
        );
      }

      const snaps = await Promise.all(queries.map((q) => getDocs(q)));
      for (const s of snaps) {
        for (const d of s.docs) {
          results.set(d.id, { id: d.id, ...(d.data() as Omit<CelebrationNotification, 'id'>) });
        }
      }
    }

    return Array.from(results.values()).sort((a, b) =>
      b.celebrationDate.localeCompare(a.celebrationDate)
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'celebrationNotifications');
  }
}

export async function fetchMyNotificationReads(uid: string): Promise<Set<string>> {
  try {
    const snap = await getDocs(query(collection(db, 'notificationReads'), where('uid', '==', uid)));
    const readIds = new Set<string>();
    for (const d of snap.docs) {
      const data = d.data() as { notificationId?: string };
      if (data.notificationId) readIds.add(data.notificationId);
    }
    return readIds;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'notificationReads');
  }
}

export async function markNotificationAsRead(uid: string, notificationId: string): Promise<void> {
  const readDocId = `${uid}_${notificationId}`.replace(/[^a-zA-Z0-9_-]/g, '');
  try {
    await setDoc(doc(db, 'notificationReads', readDocId), {
      uid,
      notificationId,
      readAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `notificationReads/${readDocId}`);
  }
}

export async function markAllNotificationsAsRead(
  uid: string,
  notificationIds: string[]
): Promise<void> {
  if (notificationIds.length === 0) return;
  await Promise.all(notificationIds.map((id) => markNotificationAsRead(uid, id)));
}

export async function evaluateCelebrationsOnServer(params: {
  profiles: CelebrationProfile[];
  settings?: CelebrationSettings | null;
  companyName?: string;
  lookbackDays?: number;
  lookaheadDays?: number;
}): Promise<{
  todayDate: string;
  timezone: string;
  occurrences: ComputedCelebrationOccurrence[];
  notificationsToPersist: ComputedCelebrationOccurrence[];
}> {
  const celSettings = normalizeCelebrationSettings(params.settings);
  const user = auth.currentUser;
  if (user) {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/celebrations/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          profiles: params.profiles,
          celebrationSettings: celSettings,
          companyName: params.companyName || 'TalentGrade',
          lookbackDays: params.lookbackDays ?? 7,
          lookaheadDays: params.lookaheadDays ?? Math.max(30, celSettings.upcomingWindowDays),
        }),
      });
      if (res.ok) {
        return res.json();
      }
    } catch {
      // Fallback safely to shared deterministic engine if transient network glitch
    }
  }

  return evaluateCelebrationsWindow({
    profiles: params.profiles,
    settings: celSettings,
    companyName: params.companyName || 'TalentGrade',
    lookbackDays: params.lookbackDays ?? 7,
    lookaheadDays: params.lookaheadDays ?? Math.max(30, celSettings.upcomingWindowDays),
  });
}

/**
 * Evaluates today + recent 7-day missed celebration window using server clock,
 * and persists missing deterministic annual notifications (`cel_{type}_{employeeId}_{year}`)
 * so duplicates can never be created for the same employee + event + year.
 */
export async function syncCelebrationsAndPersistNotifications(params: {
  actor: Employee;
  settings: CompanySettings | null;
  profiles: CelebrationProfile[];
  existingNotifications: CelebrationNotification[];
}): Promise<{
  todayDate: string;
  timezone: string;
  occurrences: ComputedCelebrationOccurrence[];
  createdCount: number;
}> {
  const celSettings = normalizeCelebrationSettings(
    params.settings?.celebrationSettings || DEFAULT_CELEBRATION_SETTINGS
  );
  const evaluated = await evaluateCelebrationsOnServer({
    profiles: params.profiles,
    settings: celSettings,
    companyName: params.settings?.companyName || 'TalentGrade',
    lookbackDays: 7,
    lookaheadDays: Math.max(30, celSettings.upcomingWindowDays),
  });

  const existingIds = new Set(params.existingNotifications.map((n) => n.id));
  const actorUid = auth.currentUser?.uid || params.actor.uid;
  let createdCount = 0;

  // Persist notifications for today (and catch up recent past days within 7-day lookback)
  for (const occ of evaluated.notificationsToPersist) {
    if (existingIds.has(occ.notificationId)) continue;
    // Skip creating notifications on behalf of others if scope forbids viewing? No, active employees can create deterministic cel_* notifications,
    // OR check existence first via getDoc to avoid hitting already-exists conflicts cleanly.
    try {
      const notifRef = doc(db, 'celebrationNotifications', occ.notificationId);
      const snap = await getDoc(notifRef);
      if (snap.exists()) continue;

      await setDoc(
        notifRef,
        cleanObject({
          type: occ.type,
          employeeId: occ.employeeId,
          employeeUid: occ.employeeUid || '',
          employeeName: occ.employeeName,
          department: occ.department,
          designation: occ.designation || '',
          profilePhotoAssetId: occ.profilePhotoAssetId || undefined,
          celebrationDate: occ.celebrationDate,
          celebrationMonthDay: occ.celebrationMonthDay,
          year: occ.year,
          yearsCompleted: occ.yearsCompleted,
          title: occ.title,
          message: occ.message,
          audienceScope: celSettings.visibilityScope,
          createdByUid: actorUid,
          createdAt: serverTimestamp(),
        })
      );
      createdCount += 1;
      existingIds.add(occ.notificationId);
    } catch (err) {
      // Ignore permission errors if scope restricted or race already created the deterministic doc
      console.debug(`Celebration notification persist skipped (${occ.notificationId}):`, err);
    }
  }

  return {
    todayDate: evaluated.todayDate,
    timezone: evaluated.timezone,
    occurrences: evaluated.occurrences,
    createdCount,
  };
}

/**
 * Ensures a celebration notification document exists when an employee sends a wish
 * for an active today celebration (if not yet persisted).
 */
export async function ensureCelebrationNotificationForOccurrence(params: {
  occurrence: ComputedCelebrationOccurrence;
  actor: Employee;
  settings: CompanySettings | null;
}): Promise<string> {
  const celSettings = normalizeCelebrationSettings(params.settings?.celebrationSettings);
  const notifId = makeCelebrationNotificationId(
    params.occurrence.type,
    params.occurrence.employeeId,
    params.occurrence.year
  );
  const ref = doc(db, 'celebrationNotifications', notifId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const actorUid = auth.currentUser?.uid || params.actor.uid;
    await setDoc(
      ref,
      cleanObject({
        type: params.occurrence.type,
        employeeId: params.occurrence.employeeId,
        employeeUid: params.occurrence.employeeUid || '',
        employeeName: params.occurrence.employeeName,
        department: params.occurrence.department,
        designation: params.occurrence.designation || '',
        profilePhotoAssetId: params.occurrence.profilePhotoAssetId || undefined,
        celebrationDate: params.occurrence.celebrationDate,
        celebrationMonthDay: params.occurrence.celebrationMonthDay,
        year: params.occurrence.year,
        yearsCompleted: params.occurrence.yearsCompleted,
        title: params.occurrence.title,
        message: params.occurrence.message,
        audienceScope: celSettings.visibilityScope,
        createdByUid: actorUid,
        createdAt: serverTimestamp(),
      })
    );
  }
  return notifId;
}

export async function fetchCelebrationWishes(notificationId?: string): Promise<CelebrationWish[]> {
  try {
    const q = notificationId
      ? query(collection(db, 'celebrationWishes'), where('notificationId', '==', notificationId))
      : query(collection(db, 'celebrationWishes'), orderBy('createdAt', 'desc'), limit(200));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CelebrationWish, 'id'>) }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'celebrationWishes');
  }
}

export async function postCelebrationWish(params: {
  notificationId: string;
  occurrence: Pick<
    ComputedCelebrationOccurrence,
    'type' | 'employeeId' | 'employeeName'
  >;
  author: Employee;
  emoji: string;
  message: string;
}): Promise<CelebrationWish> {
  const trimmed = params.message.trim().slice(0, 400);
  if (!trimmed) {
    throw new Error('Please write a short celebration wish before sending.');
  }
  const id = makeSafeId('wish');
  const actorUid = auth.currentUser?.uid || params.author.uid;
  const safeEmoji = (CELEBRATION_EMOJI_OPTIONS as readonly string[]).includes(params.emoji)
    ? params.emoji
    : '🎉';

  const payload = cleanObject({
    notificationId: params.notificationId,
    type: params.occurrence.type,
    recipientEmployeeId: params.occurrence.employeeId,
    recipientName: params.occurrence.employeeName,
    authorUid: actorUid,
    authorEmployeeId: params.author.id,
    authorName: params.author.fullName,
    authorDepartment: params.author.department,
    authorPhotoAssetId: params.author.profilePhotoAssetId || undefined,
    emoji: safeEmoji,
    message: trimmed,
    createdAt: serverTimestamp(),
  });

  try {
    await setDoc(doc(db, 'celebrationWishes', id), payload);
    return {
      id,
      ...(payload as Omit<CelebrationWish, 'id'>),
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `celebrationWishes/${id}`);
  }
}

export async function deleteCelebrationWish(wish: CelebrationWish, actor: Employee): Promise<void> {
  try {
    await deleteDoc(doc(db, 'celebrationWishes', wish.id));
    if (actor.role === 'super_admin' && wish.authorUid !== actor.uid) {
      await writeAuditLog({
        actor,
        action: 'MODERATE_CELEBRATION_WISH',
        entityType: 'CelebrationWish',
        entityId: wish.id,
        previousValues: {
          authorName: wish.authorName,
          recipientName: wish.recipientName,
          message: wish.message,
        },
        summary: `${actor.fullName} removed celebration wish from ${wish.authorName} to ${wish.recipientName}.`,
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `celebrationWishes/${wish.id}`);
  }
}

export async function resolveCelebrationPhotoUrls(
  profiles: CelebrationProfile[]
): Promise<Record<string, string>> {
  const uniqueAssetIds = Array.from(
    new Set(
      profiles
        .map((p) => p.profilePhotoAssetId)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (uniqueAssetIds.length === 0) return {};

  const assetEntries = await Promise.all(
    uniqueAssetIds.map(async (assetId) => {
      const asset = await fetchMediaAsset(assetId);
      return asset?.dataUrl ? ([assetId, asset.dataUrl] as const) : null;
    })
  );
  const byAssetId = new Map<string, string>();
  for (const item of assetEntries) {
    if (item) byAssetId.set(item[0], item[1]);
  }

  const out: Record<string, string> = {};
  for (const p of profiles) {
    if (p.profilePhotoAssetId && byAssetId.has(p.profilePhotoAssetId)) {
      out[p.employeeId] = byAssetId.get(p.profilePhotoAssetId)!;
    }
  }
  return out;
}
