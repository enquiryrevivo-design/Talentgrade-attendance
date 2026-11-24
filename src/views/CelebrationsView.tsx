import React, { useMemo, useState } from 'react';
import {
  Award,
  Cake,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  List,
  MessageSquareHeart,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCelebrations } from '../context/CelebrationContext';
import { useToast } from '../components/Toast';
import { ComputedCelebrationOccurrence } from '../types/hr';
import {
  evaluateCelebrationsWindow,
  formatAnniversaryHeadline,
  formatCelebrationMonthDayLabel,
  makeCelebrationNotificationId,
  resolveMonthDayForYear,
} from '../../shared/celebrationEngine';

const MONTHS = [
  { num: 1, label: 'January', short: 'Jan' },
  { num: 2, label: 'February', short: 'Feb' },
  { num: 3, label: 'March', short: 'Mar' },
  { num: 4, label: 'April', short: 'Apr' },
  { num: 5, label: 'May', short: 'May' },
  { num: 6, label: 'June', short: 'Jun' },
  { num: 7, label: 'July', short: 'Jul' },
  { num: 8, label: 'August', short: 'Aug' },
  { num: 9, label: 'September', short: 'Sep' },
  { num: 10, label: 'October', short: 'Oct' },
  { num: 11, label: 'November', short: 'Nov' },
  { num: 12, label: 'December', short: 'Dec' },
];

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function CelebrationsView() {
  const { employee, settings } = useAuth();
  const { showToast } = useToast();
  const {
    celebrationSettings,
    todayDate,
    profiles,
    photoUrls,
    wishes,
    openCelebrationByOccurrence,
    removeWish,
  } = useCelebrations();

  const currentYear = Number(todayDate.slice(0, 4)) || new Date().getFullYear();
  const currentMonthNum = Number(todayDate.slice(5, 7)) || new Date().getMonth() + 1;

  const [viewMode, setViewMode] = useState<'upcoming30' | 'calendar' | 'list' | 'feed'>('upcoming30');
  const [typeFilter, setTypeFilter] = useState<'all' | 'birthday' | 'anniversary'>('all');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [calendarMonth, setCalendarMonth] = useState<number>(currentMonthNum);
  const [calendarYear, setCalendarYear] = useState<number>(currentYear);

  const companyName = settings?.companyName || 'TalentGrade';

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const p of profiles) {
      if (p.department) set.add(p.department);
    }
    return Array.from(set).sort();
  }, [profiles]);

  // 1. Authoritative Upcoming 30 Days occurrences anchored to todayDate in company timezone
  const next30Occurrences = useMemo(() => {
    const refNow = new Date(`${todayDate}T12:00:00Z`);
    const res = evaluateCelebrationsWindow({
      profiles,
      settings: { ...celebrationSettings, timezone: 'UTC' },
      companyName,
      referenceNow: refNow,
      lookbackDays: 0,
      lookaheadDays: 30,
    });
    return res.occurrences;
  }, [profiles, celebrationSettings, companyName, todayDate]);

  // 2. Full Calendar Year occurrences (for Calendar & List views across all months)
  const annualOccurrences = useMemo(() => {
    const list: ComputedCelebrationOccurrence[] = [];
    const todayMs = new Date(`${todayDate}T00:00:00Z`).getTime();

    for (const emp of profiles) {
      if (emp.status !== 'Active') continue;

      if (celebrationSettings.birthdaysEnabled && emp.birthdayMonthDay) {
        const celDate = resolveMonthDayForYear(emp.birthdayMonthDay, calendarYear);
        if (celDate) {
          const daysUntil = Math.round(
            (new Date(`${celDate}T00:00:00Z`).getTime() - todayMs) / 86400000
          );
          list.push({
            notificationId: makeCelebrationNotificationId('birthday', emp.employeeId, calendarYear),
            type: 'birthday',
            employeeId: emp.employeeId,
            employeeUid: emp.employeeUid || '',
            employeeName: emp.fullName,
            department: emp.department,
            designation: emp.designation || '',
            profilePhotoAssetId: emp.profilePhotoAssetId,
            celebrationDate: celDate,
            celebrationMonthDay: emp.birthdayMonthDay,
            year: calendarYear,
            daysUntil,
            title: `Birthday · ${emp.fullName}`,
            message: `Happy Birthday to ${emp.fullName} (${emp.department})!`,
          });
        }
      }

      if (celebrationSettings.anniversariesEnabled && emp.joiningDate) {
        const joinYear = Number(emp.joiningDate.slice(0, 4));
        const joinMd = emp.joiningDate.slice(5, 10);
        const completedYears = calendarYear - joinYear;
        if (completedYears >= 1) {
          const celDate = resolveMonthDayForYear(joinMd, calendarYear);
          if (celDate) {
            const daysUntil = Math.round(
              (new Date(`${celDate}T00:00:00Z`).getTime() - todayMs) / 86400000
            );
            list.push({
              notificationId: makeCelebrationNotificationId(
                'anniversary',
                emp.employeeId,
                calendarYear
              ),
              type: 'anniversary',
              employeeId: emp.employeeId,
              employeeUid: emp.employeeUid || '',
              employeeName: emp.fullName,
              department: emp.department,
              designation: emp.designation || '',
              profilePhotoAssetId: emp.profilePhotoAssetId,
              celebrationDate: celDate,
              celebrationMonthDay: joinMd,
              year: calendarYear,
              yearsCompleted: completedYears,
              daysUntil,
              title: `Work Anniversary · ${emp.fullName}`,
              message: formatAnniversaryHeadline(completedYears, companyName),
            });
          }
        }
      }
    }

    return list.sort((a, b) => {
      const cmp = a.celebrationDate.localeCompare(b.celebrationDate);
      if (cmp !== 0) return cmp;
      return a.employeeName.localeCompare(b.employeeName);
    });
  }, [profiles, celebrationSettings, calendarYear, todayDate, companyName]);

  const applyFilters = (items: ComputedCelebrationOccurrence[], includeMonthFilter = true) =>
    items.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (deptFilter !== 'all' && item.department !== deptFilter) return false;
      if (includeMonthFilter && monthFilter !== 'all') {
        const itemMonth = Number(item.celebrationDate.slice(5, 7));
        if (itemMonth !== Number(monthFilter)) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !item.employeeName.toLowerCase().includes(q) &&
          !item.department.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });

  const filteredUpcoming30 = useMemo(
    () => applyFilters(next30Occurrences, true),
    [next30Occurrences, typeFilter, deptFilter, monthFilter, search]
  );

  const filteredAnnual = useMemo(
    () => applyFilters(annualOccurrences, true),
    [annualOccurrences, typeFilter, deptFilter, monthFilter, search]
  );

  const filteredCalendarItems = useMemo(() => {
    const mm = String(calendarMonth).padStart(2, '0');
    const prefix = `${calendarYear}-${mm}-`;
    return applyFilters(
      annualOccurrences.filter((item) => item.celebrationDate.startsWith(prefix)),
      false
    );
  }, [annualOccurrences, calendarMonth, calendarYear, typeFilter, deptFilter, search]);

  const filteredWishes = useMemo(() => {
    return wishes.filter((w) => {
      if (typeFilter !== 'all' && w.type !== typeFilter) return false;
      if (deptFilter !== 'all' && w.authorDepartment !== deptFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !w.recipientName.toLowerCase().includes(q) &&
          !w.authorName.toLowerCase().includes(q) &&
          !w.message.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [wishes, typeFilter, deptFilter, search]);

  if (!employee) return null;

  const daysInCalMonth = new Date(calendarYear, calendarMonth, 0).getDate();
  const firstDayOffset = new Date(calendarYear, calendarMonth - 1, 1).getDay();
  const calMonthLabel = MONTHS.find((m) => m.num === calendarMonth)?.label || '';

  const renderOccurrenceCard = (occ: ComputedCelebrationOccurrence) => {
    const avatar = photoUrls[occ.employeeId];
    const isBirthday = occ.type === 'birthday';
    const isToday = occ.celebrationDate === todayDate;
    const wishCount = wishes.filter((w) => w.notificationId === occ.notificationId).length;

    return (
      <div
        key={`${occ.notificationId}_${occ.celebrationDate}`}
        className={`p-4 rounded-2xl border bg-white dark:bg-zinc-900 flex flex-col justify-between gap-3 ${
          isToday
            ? 'border-[#B5121B]/60 ring-1 ring-[#B5121B]/20'
            : 'border-zinc-200 dark:border-zinc-800'
        }`}
      >
        <div className="flex items-start gap-3">
          {avatar ? (
            <img
              src={avatar}
              alt={occ.employeeName}
              className="w-11 h-11 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
            />
          ) : (
            <div className="w-11 h-11 rounded-full bg-zinc-950 dark:bg-zinc-800 text-white flex items-center justify-center text-xs font-semibold shrink-0">
              {getInitials(occ.employeeName)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#B5121B] dark:text-red-400 inline-flex items-center gap-1">
                {isBirthday ? <Cake className="w-3.5 h-3.5" /> : <Award className="w-3.5 h-3.5" />}
                {isBirthday
                  ? 'Birthday'
                  : `${occ.yearsCompleted} ${occ.yearsCompleted === 1 ? 'Year' : 'Years'}`}
              </span>
              <span className="text-[11px] font-mono tabular-nums text-zinc-500">
                {formatCelebrationMonthDayLabel(occ.celebrationMonthDay)}
              </span>
            </div>
            <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-100 truncate mt-0.5">
              {occ.employeeName}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {occ.department}
              {occ.designation ? ` · ${occ.designation}` : ''}
            </div>
            <div className="text-[11px] text-zinc-600 dark:text-zinc-300 mt-1.5">
              {isToday
                ? isBirthday
                  ? 'Celebrating today'
                  : occ.message
                : occ.daysUntil === 1
                ? 'Tomorrow'
                : occ.daysUntil > 1
                ? `In ${occ.daysUntil} days`
                : `${formatCelebrationMonthDayLabel(occ.celebrationMonthDay)} (${occ.year})`}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => openCelebrationByOccurrence(occ)}
          className="w-full min-h-[38px] px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-[#B5121B] text-xs font-medium inline-flex items-center justify-center gap-1.5"
        >
          <MessageSquareHeart className="w-3.5 h-3.5 text-[#B5121B]" />
          <span>
            {isToday && celebrationSettings.wishesEnabled
              ? `Send Wishes${wishCount > 0 ? ` (${wishCount})` : ''}`
              : `Details${wishCount > 0 ? ` (${wishCount} wishes)` : ''}`}
          </span>
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#B5121B]" />
            <h1 className="text-2xl font-display font-semibold text-zinc-950 dark:text-zinc-100">
              Team Celebrations
            </h1>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Birthdays, work anniversaries, upcoming milestones, and team wishes · Birth years strictly private
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-zinc-200/70 dark:bg-zinc-800 rounded-xl overflow-x-auto">
          {(
            [
              { id: 'upcoming30', label: 'Upcoming 30 Days', icon: Sparkles },
              { id: 'calendar', label: 'Calendar View', icon: CalendarIcon },
              { id: 'list', label: 'List View', icon: List },
              { id: 'feed', label: `Celebration Feed (${wishes.length})`, icon: MessageSquareHeart },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setViewMode(t.id)}
                className={`px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap inline-flex items-center gap-1.5 ${
                  viewMode === t.id
                    ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-wrap items-center gap-3 text-xs">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee or department..."
            className="w-full min-h-[40px] pl-9 pr-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'all' | 'birthday' | 'anniversary')}
          className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
        >
          <option value="all">All Celebration Types</option>
          <option value="birthday">Birthdays Only</option>
          <option value="anniversary">Work Anniversaries Only</option>
        </select>

        {viewMode !== 'feed' && viewMode !== 'calendar' && (
          <select
            value={monthFilter}
            onChange={(e) => {
              setMonthFilter(e.target.value);
              if (e.target.value !== 'all') {
                setCalendarMonth(Number(e.target.value));
              }
            }}
            className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
          >
            <option value="all">All Months</option>
            {MONTHS.map((m) => (
              <option key={m.num} value={String(m.num)}>
                {m.label}
              </option>
            ))}
          </select>
        )}

        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="min-h-[40px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
        >
          <option value="all">All Departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {/* VIEW 1: UPCOMING 30 DAYS */}
      {viewMode === 'upcoming30' && (
        <section className="space-y-4">
          {filteredUpcoming30.length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
              No birthdays or work anniversaries match your filters in the upcoming 30 days.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredUpcoming30.map((occ) => renderOccurrenceCard(occ))}
            </div>
          )}
        </section>
      )}

      {/* VIEW 2: CALENDAR VIEW */}
      {viewMode === 'calendar' && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-display font-semibold">
                {calMonthLabel} {calendarYear}
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {filteredCalendarItems.length} celebration{filteredCalendarItems.length === 1 ? '' : 's'} this month
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (calendarMonth === 1) {
                    setCalendarMonth(12);
                    setCalendarYear((y) => y - 1);
                  } else {
                    setCalendarMonth((m) => m - 1);
                  }
                }}
                aria-label="Previous month"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <select
                value={calendarMonth}
                onChange={(e) => setCalendarMonth(Number(e.target.value))}
                className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs font-medium"
              >
                {MONTHS.map((m) => (
                  <option key={m.num} value={m.num}>
                    {m.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (calendarMonth === 12) {
                    setCalendarMonth(1);
                    setCalendarYear((y) => y + 1);
                  } else {
                    setCalendarMonth((m) => m + 1);
                  }
                }}
                aria-label="Next month"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-zinc-500">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: firstDayOffset }).map((_, idx) => (
              <div
                key={`blank_${idx}`}
                className="min-h-[76px] sm:min-h-[90px] rounded-xl bg-zinc-50/60 dark:bg-zinc-950/30"
              />
            ))}
            {Array.from({ length: daysInCalMonth }).map((_, idx) => {
              const dayNum = idx + 1;
              const dateKey = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(
                dayNum
              ).padStart(2, '0')}`;
              const dayEvents = filteredCalendarItems.filter((i) => i.celebrationDate === dateKey);
              const isToday = dateKey === todayDate;

              return (
                <div
                  key={dateKey}
                  className={`min-h-[76px] sm:min-h-[90px] rounded-xl border p-1.5 flex flex-col gap-1 ${
                    isToday
                      ? 'border-[#B5121B] bg-red-50/30 dark:bg-red-950/20'
                      : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                  }`}
                >
                  <div className="text-[11px] font-mono font-semibold text-zinc-700 dark:text-zinc-300">
                    {dayNum}
                  </div>
                  <div className="space-y-1 overflow-y-auto">
                    {dayEvents.map((ev) => (
                      <button
                        key={ev.notificationId}
                        type="button"
                        onClick={() => openCelebrationByOccurrence(ev)}
                        className="w-full text-left px-1.5 py-1 rounded-md text-[10px] font-medium truncate bg-zinc-100 dark:bg-zinc-800 hover:bg-[#B5121B] hover:text-white transition-colors flex items-center gap-1"
                        title={ev.title}
                      >
                        {ev.type === 'birthday' ? (
                          <Cake className="w-2.5 h-2.5 shrink-0 text-[#B5121B]" />
                        ) : (
                          <Award className="w-2.5 h-2.5 shrink-0 text-[#B5121B]" />
                        )}
                        <span className="truncate">{ev.employeeName.split(' ')[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* VIEW 3: LIST VIEW */}
      {viewMode === 'list' && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
          {filteredAnnual.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
              No celebrations match the selected filters for {calendarYear}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                    <th className="py-3 px-4 font-medium">Employee</th>
                    <th className="py-3 px-4 font-medium">Department</th>
                    <th className="py-3 px-4 font-medium">Celebration</th>
                    <th className="py-3 px-4 font-medium">Date</th>
                    <th className="py-3 px-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filteredAnnual.map((occ) => {
                    const avatar = photoUrls[occ.employeeId];
                    const isBirthday = occ.type === 'birthday';
                    return (
                      <tr key={occ.notificationId} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            {avatar ? (
                              <img
                                src={avatar}
                                alt={occ.employeeName}
                                className="w-8 h-8 rounded-full object-cover shrink-0"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-zinc-900 dark:bg-zinc-800 text-white flex items-center justify-center text-[10px] font-semibold shrink-0">
                                {getInitials(occ.employeeName)}
                              </div>
                            )}
                            <div>
                              <div className="font-semibold text-zinc-950 dark:text-zinc-100">
                                {occ.employeeName}
                              </div>
                              <div className="text-[11px] text-zinc-500">{occ.designation}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">{occ.department}</td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1.5 font-medium text-zinc-900 dark:text-zinc-100">
                            {isBirthday ? (
                              <Cake className="w-3.5 h-3.5 text-[#B5121B]" />
                            ) : (
                              <Award className="w-3.5 h-3.5 text-[#B5121B]" />
                            )}
                            {isBirthday
                              ? 'Birthday'
                              : `Work Anniversary (${occ.yearsCompleted} ${
                                  occ.yearsCompleted === 1 ? 'Year' : 'Years'
                                })`}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums">
                          {formatCelebrationMonthDayLabel(occ.celebrationMonthDay)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => openCelebrationByOccurrence(occ)}
                            className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-[#B5121B] text-xs font-medium"
                          >
                            {occ.celebrationDate === todayDate ? 'Send Wishes' : 'View'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* VIEW 4: CELEBRATION FEED */}
      {viewMode === 'feed' && (
        <section className="space-y-4">
          {!celebrationSettings.feedEnabled ? (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 text-center text-xs text-zinc-500">
              The Celebration Feed is currently disabled by company administration.
            </div>
          ) : filteredWishes.length === 0 ? (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
              No celebration wishes have been posted yet. Wishes posted on birthdays and work anniversaries will appear here.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredWishes.map((w) => {
                const authorAvatar = photoUrls[w.authorEmployeeId];
                const canDelete = employee.role === 'super_admin' || w.authorUid === employee.uid;
                return (
                  <div
                    key={w.id}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 flex items-start justify-between gap-4"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      {authorAvatar ? (
                        <img
                          src={authorAvatar}
                          alt={w.authorName}
                          className="w-9 h-9 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-zinc-950 dark:bg-zinc-800 text-white flex items-center justify-center text-xs font-semibold shrink-0">
                          {getInitials(w.authorName)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-950 dark:text-zinc-100">
                          {w.authorName}{' '}
                          <span className="font-normal text-zinc-500">wished</span>{' '}
                          <span className="text-[#B5121B] dark:text-red-400">{w.recipientName}</span>
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                          {w.type === 'birthday' ? 'Birthday Celebration' : 'Work Anniversary'} ·{' '}
                          {w.authorDepartment}
                        </div>
                        <p className="text-sm text-zinc-800 dark:text-zinc-200 mt-2 break-words">
                          <span className="mr-2">{w.emoji}</span>
                          {w.message}
                        </p>
                      </div>
                    </div>

                    {canDelete && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await removeWish(w);
                            showToast('Wish removed from celebration feed.', 'info');
                          } catch {
                            showToast('Could not delete wish.', 'error');
                          }
                        }}
                        title={
                          employee.role === 'super_admin'
                            ? 'Moderate / delete wish'
                            : 'Delete your wish'
                        }
                        className="p-2 rounded-lg text-zinc-400 hover:text-[#B5121B] hover:bg-red-50 dark:hover:bg-red-950/30 shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
