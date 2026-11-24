import React, { useEffect, useState } from 'react';
import { Award, Cake, CalendarDays, ChevronRight, MessageSquareHeart, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCelebrations } from '../context/CelebrationContext';
import { AppPage, ComputedCelebrationOccurrence } from '../types/hr';
import { formatCelebrationMonthDayLabel } from '../../shared/celebrationEngine';

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const CONFETTI_COLORS = ['#B5121B', '#111111', '#E11D48', '#D4D4D8', '#F59E0B'];

function CelebrationConfettiBurst({ active }: { active: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 3200);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-28 overflow-hidden z-10"
    >
      {Array.from({ length: 18 }).map((_, idx) => {
        const left = `${4 + ((idx * 19) % 92)}%`;
        const delay = `${(idx % 6) * 110}ms`;
        const duration = `${1800 + (idx % 4) * 260}ms`;
        const color = CONFETTI_COLORS[idx % CONFETTI_COLORS.length];
        return (
          <span
            key={idx}
            style={{
              left,
              backgroundColor: color,
              animationDelay: delay,
              animationDuration: duration,
            }}
            className="absolute -top-2 w-1.5 h-3 rounded-xs opacity-85 animate-bounce"
          />
        );
      })}
    </div>
  );
}

interface CelebrationsWidgetProps {
  onNavigate: (page: AppPage) => void;
}

export function CelebrationsWidget({ onNavigate }: CelebrationsWidgetProps) {
  const { employee, settings } = useAuth();
  const {
    loading,
    celebrationSettings,
    todayCelebrations,
    upcomingCelebrations,
    photoUrls,
    wishes,
    openCelebrationByOccurrence,
  } = useCelebrations();

  if (!employee) return null;

  const companyName = settings?.companyName || 'TalentGrade';
  const myTodayCelebrations = todayCelebrations.filter((c) => c.employeeId === employee.id);
  const todayBirthdays = todayCelebrations.filter((c) => c.type === 'birthday');
  const todayAnniversaries = todayCelebrations.filter((c) => c.type === 'anniversary');
  const upcomingBirthdays = upcomingCelebrations.filter((c) => c.type === 'birthday');
  const upcomingAnniversaries = upcomingCelebrations.filter((c) => c.type === 'anniversary');

  const renderCard = (occ: ComputedCelebrationOccurrence, isToday: boolean) => {
    const avatar = photoUrls[occ.employeeId];
    const isBirthday = occ.type === 'birthday';
    const wishCount = wishes.filter((w) => w.notificationId === occ.notificationId).length;

    return (
      <div
        key={`${occ.notificationId}_${occ.daysUntil}`}
        className={`p-3.5 rounded-xl border transition-colors flex flex-col justify-between gap-3 ${
          isToday
            ? 'border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/15'
            : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/60'
        }`}
      >
        <div className="flex items-start gap-3">
          {avatar ? (
            <img
              src={avatar}
              alt={occ.employeeName}
              className="w-10 h-10 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-zinc-950 dark:bg-zinc-800 text-white flex items-center justify-center text-xs font-semibold shrink-0">
              {getInitials(occ.employeeName)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#B5121B] dark:text-red-400 inline-flex items-center gap-1">
                {isBirthday ? <Cake className="w-3 h-3" /> : <Award className="w-3 h-3" />}
                {isBirthday
                  ? 'Birthday'
                  : `${occ.yearsCompleted || 1} ${occ.yearsCompleted === 1 ? 'Year' : 'Years'}`}
              </span>
              <span className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatCelebrationMonthDayLabel(occ.celebrationMonthDay)}
              </span>
            </div>

            <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-100 truncate mt-0.5">
              {occ.employeeName}
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
              {occ.department}
              {!isToday && (
                <>
                  {' '}
                  · {occ.daysUntil === 1 ? 'Tomorrow' : `In ${occ.daysUntil} days`}
                </>
              )}
            </div>
            {!isBirthday && (
              <div className="text-[11px] text-zinc-700 dark:text-zinc-300 mt-1">
                {occ.message}
              </div>
            )}
          </div>
        </div>

        {isToday && celebrationSettings.wishesEnabled && celebrationSettings.feedEnabled && (
          <button
            type="button"
            onClick={() => openCelebrationByOccurrence(occ)}
            className="w-full min-h-[38px] px-3 py-1.5 rounded-lg bg-zinc-950 dark:bg-white text-white dark:text-black text-xs font-medium inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
          >
            <MessageSquareHeart className="w-3.5 h-3.5 text-[#B5121B]" />
            <span>
              {occ.employeeId === employee.id
                ? `View Wishes (${wishCount})`
                : isBirthday
                ? `Send Birthday Wishes${wishCount > 0 ? ` (${wishCount})` : ''}`
                : `Send Anniversary Wishes${wishCount > 0 ? ` (${wishCount})` : ''}`}
            </span>
          </button>
        )}
      </div>
    );
  };

  return (
    <section className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-5 overflow-hidden">
      <CelebrationConfettiBurst active={todayCelebrations.length > 0} />

      <div className="flex flex-wrap items-center justify-between gap-3 relative z-20">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#B5121B]" />
            <h2 className="text-base font-display font-semibold text-zinc-950 dark:text-zinc-100">
              Celebrations
            </h2>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Birthdays &amp; work anniversaries across {companyName}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('celebrations')}
          className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:border-[#B5121B] inline-flex items-center gap-1.5"
        >
          <CalendarDays className="w-3.5 h-3.5 text-[#B5121B]" />
          <span>Upcoming &amp; Calendar</span>
          <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
        </button>
      </div>

      {/* Personal Celebration Banner when today is the signed-in employee's birthday or anniversary */}
      {myTodayCelebrations.length > 0 && (
        <div className="p-4 rounded-xl bg-zinc-950 dark:bg-black text-white border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-[#B5121B]">
              Happy Celebration Day
            </div>
            <div className="text-sm font-semibold mt-0.5">
              {myTodayCelebrations
                .map((c) =>
                  c.type === 'birthday'
                    ? `Happy Birthday, ${employee.fullName.split(' ')[0]}!`
                    : c.message
                )
                .join(' · ')}
            </div>
          </div>
          {celebrationSettings.feedEnabled && (
            <button
              type="button"
              onClick={() => openCelebrationByOccurrence(myTodayCelebrations[0])}
              className="min-h-[38px] px-4 py-2 rounded-lg bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold shrink-0"
            >
              View Your Wishes
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="h-24 rounded-xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          <div className="h-24 rounded-xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Today's Celebrations */}
          <div className="space-y-2.5">
            <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
              <span>Today&apos;s Celebrations</span>
              {todayCelebrations.length > 0 && (
                <span className="font-mono text-[11px] text-zinc-500">
                  {todayBirthdays.length} birthday{todayBirthdays.length === 1 ? '' : 's'} ·{' '}
                  {todayAnniversaries.length} anniversar{todayAnniversaries.length === 1 ? 'y' : 'ies'}
                </span>
              )}
            </div>

            {todayCelebrations.length === 0 ? (
              <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 text-xs text-zinc-500 dark:text-zinc-400">
                No celebrations today — stay tuned for upcoming celebrations!
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {todayCelebrations.map((occ) => renderCard(occ, true))}
              </div>
            )}
          </div>

          {/* Upcoming Celebrations (next N days) */}
          {celebrationSettings.upcomingRemindersEnabled && (
            <div className="space-y-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
                <span>Upcoming (Next {celebrationSettings.upcomingWindowDays} Days)</span>
                {upcomingCelebrations.length > 0 && (
                  <span className="font-mono text-[11px] text-zinc-500">
                    {upcomingBirthdays.length} birthday{upcomingBirthdays.length === 1 ? '' : 's'} ·{' '}
                    {upcomingAnniversaries.length} anniversar{upcomingAnniversaries.length === 1 ? 'y' : 'ies'}
                  </span>
                )}
              </div>

              {upcomingCelebrations.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  No birthdays or work anniversaries scheduled in the next{' '}
                  {celebrationSettings.upcomingWindowDays} days.
                </p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {upcomingCelebrations.slice(0, 6).map((occ) => renderCard(occ, false))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
