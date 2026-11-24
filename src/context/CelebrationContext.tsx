import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  CelebrationNotification,
  CelebrationProfile,
  CelebrationSettings,
  CelebrationWish,
  ComputedCelebrationOccurrence,
} from '../types/hr';
import { fetchAllEmployees } from '../lib/hrService';
import {
  deleteCelebrationWish,
  ensureCelebrationNotificationForOccurrence,
  ensureOwnCelebrationProfile,
  fetchCelebrationNotifications,
  fetchCelebrationProfiles,
  fetchCelebrationWishes,
  fetchMyNotificationReads,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  postCelebrationWish,
  resolveCelebrationPhotoUrls,
  syncAllCelebrationProfilesFromEmployees,
  syncCelebrationsAndPersistNotifications,
} from '../lib/celebrationService';
import {
  DEFAULT_CELEBRATION_SETTINGS,
  formatAnniversaryHeadline,
  makeCelebrationNotificationId,
  normalizeCelebrationSettings,
} from '../../shared/celebrationEngine';

export interface ActiveCelebrationTarget {
  notificationId: string;
  type: 'birthday' | 'anniversary';
  employeeId: string;
  employeeUid: string;
  employeeName: string;
  department: string;
  designation: string;
  profilePhotoAssetId?: string;
  celebrationDate: string;
  celebrationMonthDay: string;
  year: number;
  yearsCompleted?: number;
  title: string;
  message: string;
}

interface CelebrationContextValue {
  loading: boolean;
  celebrationSettings: CelebrationSettings;
  todayDate: string;
  profiles: CelebrationProfile[];
  photoUrls: Record<string, string>;
  todayCelebrations: ComputedCelebrationOccurrence[];
  upcomingCelebrations: ComputedCelebrationOccurrence[];
  notifications: CelebrationNotification[];
  readNotificationIds: Set<string>;
  unreadCount: number;
  wishes: CelebrationWish[];
  selectedTarget: ActiveCelebrationTarget | null;
  openCelebrationByOccurrence: (occ: ComputedCelebrationOccurrence) => Promise<void>;
  openCelebrationByNotification: (notif: CelebrationNotification) => Promise<void>;
  closeCelebrationModal: () => void;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  submitWish: (params: {
    target: ActiveCelebrationTarget;
    emoji: string;
    message: string;
  }) => Promise<void>;
  removeWish: (wish: CelebrationWish) => Promise<void>;
  refreshCelebrations: () => Promise<void>;
}

const CelebrationContext = createContext<CelebrationContextValue | undefined>(undefined);

export function CelebrationProvider({ children }: { children: React.ReactNode }) {
  const { employee, settings } = useAuth();

  const [loading, setLoading] = useState(false);
  const [todayDate, setTodayDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [profiles, setProfiles] = useState<CelebrationProfile[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [occurrences, setOccurrences] = useState<ComputedCelebrationOccurrence[]>([]);
  const [notifications, setNotifications] = useState<CelebrationNotification[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(new Set());
  const [wishes, setWishes] = useState<CelebrationWish[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<ActiveCelebrationTarget | null>(null);

  const celebrationSettings = useMemo(
    () => normalizeCelebrationSettings(settings?.celebrationSettings || DEFAULT_CELEBRATION_SETTINGS),
    [settings?.celebrationSettings]
  );

  const canEmployeeSeeProfile = useCallback(
    (dept: string, empId: string) => {
      if (!employee) return false;
      if (employee.role === 'super_admin' || employee.role === 'team_leader') return true;
      if (empId === employee.id) return true;
      if (celebrationSettings.visibilityScope === 'leaders_only') return false;
      if (celebrationSettings.visibilityScope === 'department') {
        return dept === employee.department;
      }
      return true;
    },
    [employee, celebrationSettings.visibilityScope]
  );

  const refreshCelebrations = useCallback(async () => {
    if (!employee) {
      setProfiles([]);
      setOccurrences([]);
      setNotifications([]);
      setReadNotificationIds(new Set());
      setWishes([]);
      return;
    }

    setLoading(true);
    try {
      await ensureOwnCelebrationProfile(employee);
      if (employee.role === 'super_admin') {
        const allEmps = await fetchAllEmployees(employee);
        await syncAllCelebrationProfilesFromEmployees(employee, allEmps);
      }

      const [loadedProfiles, loadedNotifications, loadedReads, loadedWishes] = await Promise.all([
        fetchCelebrationProfiles(),
        fetchCelebrationNotifications(employee),
        fetchMyNotificationReads(employee.uid),
        celebrationSettings.feedEnabled ? fetchCelebrationWishes() : Promise.resolve([]),
      ]);

      setProfiles(loadedProfiles);
      setReadNotificationIds(loadedReads);
      setWishes(loadedWishes);

      const syncRes = await syncCelebrationsAndPersistNotifications({
        actor: employee,
        settings,
        profiles: loadedProfiles,
        existingNotifications: loadedNotifications,
      });

      setTodayDate(syncRes.todayDate);
      setOccurrences(syncRes.occurrences);

      const finalNotifs =
        syncRes.createdCount > 0 ? await fetchCelebrationNotifications(employee) : loadedNotifications;
      setNotifications(finalNotifs);

      const urls = await resolveCelebrationPhotoUrls(loadedProfiles);
      setPhotoUrls(urls);
    } catch (err) {
      console.error('Celebration refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, [employee, settings, celebrationSettings.feedEnabled]);

  useEffect(() => {
    refreshCelebrations();
  }, [refreshCelebrations]);

  const visibleProfiles = useMemo(
    () =>
      profiles.filter(
        (p) => p.status === 'Active' && canEmployeeSeeProfile(p.department, p.employeeId)
      ),
    [profiles, canEmployeeSeeProfile]
  );

  const todayCelebrations = useMemo(
    () =>
      occurrences.filter(
        (o) => o.daysUntil === 0 && canEmployeeSeeProfile(o.department, o.employeeId)
      ),
    [occurrences, canEmployeeSeeProfile]
  );

  const upcomingCelebrations = useMemo(() => {
    if (!celebrationSettings.upcomingRemindersEnabled) return [];
    return occurrences.filter(
      (o) =>
        o.daysUntil > 0 &&
        o.daysUntil <= celebrationSettings.upcomingWindowDays &&
        canEmployeeSeeProfile(o.department, o.employeeId)
    );
  }, [occurrences, celebrationSettings.upcomingRemindersEnabled, celebrationSettings.upcomingWindowDays, canEmployeeSeeProfile]);

  const visibleNotifications = useMemo(
    () =>
      notifications.filter((n) => {
        if (n.type === 'birthday' && !celebrationSettings.birthdaysEnabled) return false;
        if (n.type === 'anniversary' && !celebrationSettings.anniversariesEnabled) return false;
        return canEmployeeSeeProfile(n.department, n.employeeId);
      }),
    [notifications, celebrationSettings.birthdaysEnabled, celebrationSettings.anniversariesEnabled, canEmployeeSeeProfile]
  );

  const unreadCount = useMemo(
    () => visibleNotifications.filter((n) => !readNotificationIds.has(n.id)).length,
    [visibleNotifications, readNotificationIds]
  );

  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!employee || readNotificationIds.has(notificationId)) return;
      setReadNotificationIds((prev) => new Set(prev).add(notificationId));
      await markNotificationAsRead(employee.uid, notificationId);
    },
    [employee, readNotificationIds]
  );

  const markAllAsRead = useCallback(async () => {
    if (!employee) return;
    const unreadIds = visibleNotifications
      .filter((n) => !readNotificationIds.has(n.id))
      .map((n) => n.id);
    if (unreadIds.length === 0) return;
    setReadNotificationIds((prev) => {
      const next = new Set(prev);
      unreadIds.forEach((id) => next.add(id));
      return next;
    });
    await markAllNotificationsAsRead(employee.uid, unreadIds);
  }, [employee, visibleNotifications, readNotificationIds]);

  const openCelebrationByOccurrence = useCallback(
    async (occ: ComputedCelebrationOccurrence) => {
      if (!employee) return;
      const notifId = makeCelebrationNotificationId(occ.type, occ.employeeId, occ.year);
      if (occ.daysUntil <= 0) {
        try {
          await ensureCelebrationNotificationForOccurrence({
            occurrence: occ,
            actor: employee,
            settings,
          });
          await markAsRead(notifId);
        } catch {
          // Non-blocking if upcoming or restricted
        }
      }
      setSelectedTarget({
        notificationId: notifId,
        type: occ.type,
        employeeId: occ.employeeId,
        employeeUid: occ.employeeUid,
        employeeName: occ.employeeName,
        department: occ.department,
        designation: occ.designation,
        profilePhotoAssetId: occ.profilePhotoAssetId,
        celebrationDate: occ.celebrationDate,
        celebrationMonthDay: occ.celebrationMonthDay,
        year: occ.year,
        yearsCompleted: occ.yearsCompleted,
        title: occ.title,
        message: occ.message,
      });
    },
    [employee, settings, markAsRead]
  );

  const openCelebrationByNotification = useCallback(
    async (notif: CelebrationNotification) => {
      if (employee) {
        await markAsRead(notif.id);
      }
      setSelectedTarget({
        notificationId: notif.id,
        type: notif.type,
        employeeId: notif.employeeId,
        employeeUid: notif.employeeUid,
        employeeName: notif.employeeName,
        department: notif.department,
        designation: notif.designation,
        profilePhotoAssetId: notif.profilePhotoAssetId,
        celebrationDate: notif.celebrationDate,
        celebrationMonthDay: notif.celebrationMonthDay,
        year: notif.year,
        yearsCompleted: notif.yearsCompleted,
        title: notif.title,
        message:
          notif.type === 'anniversary' && notif.yearsCompleted
            ? formatAnniversaryHeadline(notif.yearsCompleted, settings?.companyName || 'TalentGrade')
            : notif.message,
      });
    },
    [employee, markAsRead, settings?.companyName]
  );

  const closeCelebrationModal = useCallback(() => {
    setSelectedTarget(null);
  }, []);

  const submitWish = useCallback(
    async (params: { target: ActiveCelebrationTarget; emoji: string; message: string }) => {
      if (!employee) throw new Error('Not authenticated');
      const occ: ComputedCelebrationOccurrence = {
        ...params.target,
        daysUntil: 0,
      };
      const ensuredId = await ensureCelebrationNotificationForOccurrence({
        occurrence: occ,
        actor: employee,
        settings,
      });
      const created = await postCelebrationWish({
        notificationId: ensuredId,
        occurrence: {
          type: params.target.type,
          employeeId: params.target.employeeId,
          employeeName: params.target.employeeName,
        },
        author: employee,
        emoji: params.emoji,
        message: params.message,
      });
      setWishes((prev) => [created, ...prev]);
      const refreshedNotifs = await fetchCelebrationNotifications(employee);
      setNotifications(refreshedNotifs);
    },
    [employee, settings]
  );

  const removeWish = useCallback(
    async (wish: CelebrationWish) => {
      if (!employee) return;
      await deleteCelebrationWish(wish, employee);
      setWishes((prev) => prev.filter((w) => w.id !== wish.id));
    },
    [employee]
  );

  const value: CelebrationContextValue = {
    loading,
    celebrationSettings,
    todayDate,
    profiles: visibleProfiles,
    photoUrls,
    todayCelebrations,
    upcomingCelebrations,
    notifications: visibleNotifications,
    readNotificationIds,
    unreadCount,
    wishes,
    selectedTarget,
    openCelebrationByOccurrence,
    openCelebrationByNotification,
    closeCelebrationModal,
    markAsRead,
    markAllAsRead,
    submitWish,
    removeWish,
    refreshCelebrations,
  };

  return <CelebrationContext.Provider value={value}>{children}</CelebrationContext.Provider>;
}

export function useCelebrations() {
  const ctx = useContext(CelebrationContext);
  if (!ctx) {
    throw new Error('useCelebrations must be used within CelebrationProvider');
  }
  return ctx;
}
