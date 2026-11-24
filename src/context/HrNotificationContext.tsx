import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { AttendanceCorrection, HrNotification } from '../types/hr';
import { fetchAttendanceRegularizations, fetchHrNotifications } from '../lib/regularizationService';
import {
  fetchMyNotificationReads,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '../lib/celebrationService';

interface HrNotificationContextValue {
  loading: boolean;
  notifications: HrNotification[];
  readIds: Set<string>;
  unreadCount: number;
  regularizations: AttendanceCorrection[];
  pendingRegularizations: AttendanceCorrection[];
  pendingRegularizationCount: number;
  canReviewRegularizations: boolean;
  markAsRead: (notifId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  refreshRegularizationState: () => Promise<void>;
}

const HrNotificationContext = createContext<HrNotificationContextValue | undefined>(undefined);

export function HrNotificationProvider({ children }: { children: React.ReactNode }) {
  const { employee, settings } = useAuth();
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<HrNotification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [regularizations, setRegularizations] = useState<AttendanceCorrection[]>([]);

  const canReviewRegularizations = useMemo(() => {
    if (!employee) return false;
    return (
      employee.role === 'super_admin' ||
      (employee.role === 'team_leader' &&
        Boolean(settings?.teamLeaderPermissions?.canApproveCorrections))
    );
  }, [employee, settings?.teamLeaderPermissions?.canApproveCorrections]);

  const refreshRegularizationState = useCallback(async () => {
    if (!employee) {
      setNotifications([]);
      setReadIds(new Set());
      setRegularizations([]);
      return;
    }
    setLoading(true);
    try {
      const [notifs, reads, regs] = await Promise.all([
        fetchHrNotifications(employee, canReviewRegularizations),
        fetchMyNotificationReads(employee.uid),
        fetchAttendanceRegularizations(employee, canReviewRegularizations),
      ]);
      setNotifications(notifs);
      setReadIds(reads);
      setRegularizations(regs);
    } catch (err) {
      console.error('HR notification refresh warning:', err);
    } finally {
      setLoading(false);
    }
  }, [employee, canReviewRegularizations]);

  useEffect(() => {
    refreshRegularizationState();
  }, [refreshRegularizationState]);

  const visibleNotifications = useMemo(() => {
    if (!employee) return [];
    return notifications.filter((n) => {
      if (n.audienceType === 'user') return n.targetUid === employee.uid;
      if (n.audienceType === 'reviewers') return canReviewRegularizations;
      return false;
    });
  }, [notifications, employee, canReviewRegularizations]);

  const unreadCount = useMemo(
    () => visibleNotifications.filter((n) => !readIds.has(n.id)).length,
    [visibleNotifications, readIds]
  );

  const pendingRegularizations = useMemo(
    () => regularizations.filter((r) => r.status === 'Pending'),
    [regularizations]
  );

  const markAsRead = useCallback(
    async (notifId: string) => {
      if (!employee || readIds.has(notifId)) return;
      setReadIds((prev) => new Set(prev).add(notifId));
      await markNotificationAsRead(employee.uid, notifId);
    },
    [employee, readIds]
  );

  const markAllAsRead = useCallback(async () => {
    if (!employee) return;
    const unreadIds = visibleNotifications
      .filter((n) => !readIds.has(n.id))
      .map((n) => n.id);
    if (unreadIds.length === 0) return;
    setReadIds((prev) => {
      const next = new Set(prev);
      unreadIds.forEach((id) => next.add(id));
      return next;
    });
    await markAllNotificationsAsRead(employee.uid, unreadIds);
  }, [employee, visibleNotifications, readIds]);

  const value: HrNotificationContextValue = {
    loading,
    notifications: visibleNotifications,
    readIds,
    unreadCount,
    regularizations,
    pendingRegularizations,
    pendingRegularizationCount: pendingRegularizations.length,
    canReviewRegularizations,
    markAsRead,
    markAllAsRead,
    refreshRegularizationState,
  };

  return <HrNotificationContext.Provider value={value}>{children}</HrNotificationContext.Provider>;
}

export function useHrNotifications() {
  const ctx = useContext(HrNotificationContext);
  if (!ctx) {
    throw new Error('useHrNotifications must be used within HrNotificationProvider');
  }
  return ctx;
}
