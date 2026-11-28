import React, { useMemo, useState } from 'react';
import { BarChart3, Clock, AlertCircle, TrendingUp, Calendar } from 'lucide-react';
import {
  AttendanceCorrection,
  AttendanceRecord,
  buildWorkingHoursAnalytics,
  CompanySettings,
  DailyWorkingHoursPoint,
  Employee,
  formatMinutesAsHoursLabel,
  MonthlyWorkingHoursBucket,
  resolveAnalyticsDateRange,
  WeeklyWorkingHoursBucket,
  WorkingHoursRangePreset,
} from '../types/hr';
import { formatTimeDisplay, getEffectiveSchedule, getTodayInTimezone } from '../lib/hrService';

interface WorkingHoursAnalyticsProps {
  targetEmployee: Employee;
  attendanceRecords: AttendanceRecord[];
  approvedCorrections?: AttendanceCorrection[];
  settings: CompanySettings;
  compact?: boolean;
}

type ChartMode = 'daily' | 'weekly' | 'monthly';

export function WorkingHoursAnalytics({
  targetEmployee,
  attendanceRecords,
  approvedCorrections = [],
  settings,
  compact = false,
}: WorkingHoursAnalyticsProps) {
  const schedule = getEffectiveSchedule(targetEmployee, settings);
  const todayLocal = getTodayInTimezone(schedule.timezone);

  const [preset, setPreset] = useState<WorkingHoursRangePreset>('30d');
  const [chartMode, setChartMode] = useState<ChartMode>('daily');
  const [customStart, setCustomStart] = useState<string>(() => {
    const dt = new Date(`${todayLocal}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() - 29);
    return dt.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState<string>(todayLocal);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedWeekKey, setSelectedWeekKey] = useState<string | null>(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);

  const { startDate, endDate } = useMemo(
    () =>
      resolveAnalyticsDateRange(
        preset,
        todayLocal,
        preset === 'custom' ? customStart : undefined,
        preset === 'custom' ? customEnd : undefined
      ),
    [preset, todayLocal, customStart, customEnd]
  );

  const analytics = useMemo(() => {
    return buildWorkingHoursAnalytics({
      employee: targetEmployee,
      records: attendanceRecords,
      settings,
      startDate,
      endDate,
      approvedCorrections,
    });
  }, [targetEmployee, attendanceRecords, settings, startDate, endDate, approvedCorrections]);

  const activeDailyPoint: DailyWorkingHoursPoint | null = useMemo(() => {
    if (selectedDate) {
      const found = analytics.daily.find((d) => d.date === selectedDate);
      if (found) return found;
    }
    const latestValid = [...analytics.daily]
      .reverse()
      .find((d) => d.hasValidDuration || d.hasRecord || d.isIncompletePunch);
    return latestValid || analytics.daily[analytics.daily.length - 1] || null;
  }, [analytics.daily, selectedDate]);

  const activeWeeklyBucket: WeeklyWorkingHoursBucket | null = useMemo(() => {
    if (selectedWeekKey) {
      const found = analytics.weekly.find((w) => w.weekStart === selectedWeekKey);
      if (found) return found;
    }
    return analytics.weekly[analytics.weekly.length - 1] || null;
  }, [analytics.weekly, selectedWeekKey]);

  const activeMonthlyBucket: MonthlyWorkingHoursBucket | null = useMemo(() => {
    if (selectedMonthKey) {
      const found = analytics.monthly.find((m) => m.month === selectedMonthKey);
      if (found) return found;
    }
    return analytics.monthly[analytics.monthly.length - 1] || null;
  }, [analytics.monthly, selectedMonthKey]);

  const svgWidth = 760;
  const svgHeight = compact ? 210 : 250;
  const padLeft = 42;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 34;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;

  const dailyMaxHours = useMemo(() => {
    const peak = analytics.daily.reduce((m, d) => Math.max(m, d.workingHours), 0);
    return Math.max(10, Math.ceil(peak + 1));
  }, [analytics.daily]);

  const weeklyMaxHours = useMemo(() => {
    const peak = analytics.weekly.reduce((m, w) => Math.max(m, w.totalHours), 0);
    return Math.max(40, Math.ceil(peak / 5) * 5);
  }, [analytics.weekly]);

  const monthlyMaxHours = useMemo(() => {
    const peak = analytics.monthly.reduce((m, mItem) => Math.max(m, mItem.totalHours), 0);
    return Math.max(160, Math.ceil(peak / 20) * 20);
  }, [analytics.monthly]);

  const barColorForDaily = (pt: DailyWorkingHoursPoint): string => {
    if (!pt.hasValidDuration) {
      if (pt.status === 'Incomplete Attendance' || pt.isIncompletePunch) return '#F59E0B';
      return '#D4D4D8';
    }
    if (pt.isLate || pt.status === 'Late') return '#F59E0B';
    if (pt.status === 'Half Day') return '#0EA5E9';
    return '#B5121B';
  };

  return (
    <div className="space-y-4">
      {/* Header & Range Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-100">
            <BarChart3 className="w-4 h-4 text-[#B5121B]" />
            Working Hours History &amp; Analytics
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 font-mono">
            {analytics.summary.startDate} → {analytics.summary.endDate} · Strict punch-in/punch-out verified ({schedule.timezone})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-[11px]">
            {(
              [
                { id: '7d', label: '7D' },
                { id: '30d', label: '30D' },
                { id: 'month', label: 'This Month' },
                { id: 'custom', label: 'Custom' },
              ] as const
            ).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  setPreset(r.id);
                  setSelectedDate(null);
                  setSelectedWeekKey(null);
                  setSelectedMonthKey(null);
                }}
                className={`px-2.5 py-1.5 rounded-lg font-medium whitespace-nowrap ${
                  preset === r.id
                    ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-[11px]">
            {(
              [
                { id: 'daily', label: 'Daily' },
                { id: 'weekly', label: 'Weekly' },
                { id: 'monthly', label: 'Monthly' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setChartMode(m.id)}
                className={`px-2.5 py-1.5 rounded-lg font-medium whitespace-nowrap ${
                  chartMode === m.id
                    ? 'bg-black dark:bg-white text-white dark:text-black shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {preset === 'custom' && (
        <div className="flex flex-wrap items-center gap-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 text-xs">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-zinc-500" />
            <span className="font-medium">From</span>
            <input
              type="date"
              value={customStart}
              max={customEnd}
              onChange={(e) => setCustomStart(e.target.value)}
              className="min-h-[34px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium">To</span>
            <input
              type="date"
              value={customEnd}
              min={customStart}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="min-h-[34px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
            />
          </div>
        </div>
      )}

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Total Hours</div>
          <div className="text-base font-bold font-mono tabular-nums mt-0.5 text-zinc-950 dark:text-zinc-100">
            {formatMinutesAsHoursLabel(analytics.summary.totalMinutes)}
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Avg Daily Hours</div>
          <div className="text-base font-bold font-mono tabular-nums mt-0.5 text-zinc-950 dark:text-zinc-100">
            {analytics.summary.workingDaysRecorded > 0
              ? `${analytics.summary.averageDailyHours.toFixed(1)}h`
              : '—'}
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Days Worked</div>
          <div className="text-base font-bold font-mono tabular-nums mt-0.5 text-emerald-700 dark:text-emerald-400">
            {analytics.summary.workingDaysRecorded}
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Highest Day</div>
          <div className="text-base font-bold font-mono tabular-nums mt-0.5 text-zinc-950 dark:text-zinc-100">
            {analytics.summary.highestDay
              ? formatMinutesAsHoursLabel(analytics.summary.highestDay.minutes)
              : '—'}
          </div>
          {analytics.summary.highestDay && (
            <div className="text-[10px] font-mono text-zinc-500 truncate">
              {analytics.summary.highestDay.date}
            </div>
          )}
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Lowest Day</div>
          <div className="text-base font-bold font-mono tabular-nums mt-0.5 text-zinc-950 dark:text-zinc-100">
            {analytics.summary.lowestDay
              ? formatMinutesAsHoursLabel(analytics.summary.lowestDay.minutes)
              : '—'}
          </div>
          {analytics.summary.lowestDay && (
            <div className="text-[10px] font-mono text-zinc-500 truncate">
              {analytics.summary.lowestDay.date}
            </div>
          )}
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Late Arrivals</div>
          <div className="text-base font-bold font-mono tabular-nums mt-0.5 text-amber-600 dark:text-amber-400">
            {analytics.summary.lateArrivalsCount}
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Missing / Incomplete</div>
          <div className="text-base font-bold font-mono tabular-nums mt-0.5 text-[#B5121B] dark:text-red-400">
            {analytics.summary.missingAttendanceCount + analytics.summary.incompleteRecordsCount}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono">
            {analytics.summary.incompleteRecordsCount} open punch
          </div>
        </div>
      </div>

      {/* Main Chart Card */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#B5121B]" />
              On-Time Full Day
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
              Late / Incomplete
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-sky-500" />
              Half Day
            </span>
            {chartMode === 'daily' && analytics.summary.averageDailyHours > 0 && (
              <span className="inline-flex items-center gap-1.5 font-mono">
                <span className="w-4 border-t-2 border-dashed border-zinc-400" />
                Avg {analytics.summary.averageDailyHours.toFixed(1)}h/day
              </span>
            )}
          </div>
          <span>Hover or click a bar to inspect punch details</span>
        </div>

        <div className="w-full overflow-x-auto">
          {chartMode === 'daily' && (
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full min-w-[520px] h-auto select-none"
              role="img"
              aria-label="Daily working hours chart"
            >
              {/* Y-Axis gridlines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const yVal = Math.round(dailyMaxHours * ratio * 10) / 10;
                const y = padTop + plotH - ratio * plotH;
                return (
                  <g key={ratio}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={svgWidth - padRight}
                      y2={y}
                      stroke="currentColor"
                      className="text-zinc-200 dark:text-zinc-800"
                      strokeWidth={1}
                    />
                    <text
                      x={padLeft - 6}
                      y={y + 3}
                      textAnchor="end"
                      className="fill-zinc-400 text-[10px] font-mono"
                    >
                      {yVal}h
                    </text>
                  </g>
                );
              })}

              {/* Average daily hours dashed line */}
              {analytics.summary.averageDailyHours > 0 && (
                <line
                  x1={padLeft}
                  y1={padTop + plotH - (analytics.summary.averageDailyHours / dailyMaxHours) * plotH}
                  x2={svgWidth - padRight}
                  y2={padTop + plotH - (analytics.summary.averageDailyHours / dailyMaxHours) * plotH}
                  stroke="#71717A"
                  strokeDasharray="4 4"
                  strokeWidth={1.2}
                />
              )}

              {/* Daily bars */}
              {analytics.daily.map((pt, idx) => {
                const count = Math.max(1, analytics.daily.length);
                const slotW = plotW / count;
                const barW = Math.max(4, Math.min(26, slotW * 0.68));
                const x = padLeft + idx * slotW + (slotW - barW) / 2;
                const barH = pt.hasValidDuration
                  ? Math.max(2, (pt.workingHours / dailyMaxHours) * plotH)
                  : pt.status === 'Incomplete Attendance' || pt.isIncompletePunch
                  ? 6
                  : 2;
                const y = padTop + plotH - barH;
                const isSelected = activeDailyPoint?.date === pt.date;
                const showTick =
                  count <= 10 ||
                  idx === 0 ||
                  idx === count - 1 ||
                  idx % Math.ceil(count / 8) === 0;

                return (
                  <g
                    key={pt.date}
                    className="cursor-pointer"
                    onMouseEnter={() => setSelectedDate(pt.date)}
                    onClick={() => setSelectedDate(pt.date)}
                  >
                    <rect
                      x={padLeft + idx * slotW}
                      y={padTop}
                      width={slotW}
                      height={plotH}
                      fill="transparent"
                    />
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={barH}
                      rx={3}
                      fill={barColorForDaily(pt)}
                      opacity={isSelected ? 1 : pt.hasValidDuration ? 0.85 : 0.45}
                      stroke={isSelected ? '#09090B' : 'none'}
                      strokeWidth={isSelected ? 1.5 : 0}
                    />
                    {showTick && (
                      <text
                        x={x + barW / 2}
                        y={svgHeight - 10}
                        textAnchor="middle"
                        className="fill-zinc-500 text-[9px] font-mono"
                      >
                        {pt.date.slice(5)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}

          {chartMode === 'weekly' && (
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full min-w-[520px] h-auto select-none"
              role="img"
              aria-label="Weekly working hours trend"
            >
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const yVal = Math.round(weeklyMaxHours * ratio);
                const y = padTop + plotH - ratio * plotH;
                return (
                  <g key={ratio}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={svgWidth - padRight}
                      y2={y}
                      stroke="currentColor"
                      className="text-zinc-200 dark:text-zinc-800"
                      strokeWidth={1}
                    />
                    <text x={padLeft - 6} y={y + 3} textAnchor="end" className="fill-zinc-400 text-[10px] font-mono">
                      {yVal}h
                    </text>
                  </g>
                );
              })}

              {analytics.weekly.map((wk, idx) => {
                const count = Math.max(1, analytics.weekly.length);
                const slotW = plotW / count;
                const barW = Math.max(12, Math.min(44, slotW * 0.55));
                const x = padLeft + idx * slotW + (slotW - barW) / 2;
                const barH = Math.max(3, (wk.totalHours / weeklyMaxHours) * plotH);
                const y = padTop + plotH - barH;
                const isSelected = activeWeeklyBucket?.weekStart === wk.weekStart;
                return (
                  <g
                    key={wk.weekStart}
                    className="cursor-pointer"
                    onMouseEnter={() => setSelectedWeekKey(wk.weekStart)}
                    onClick={() => setSelectedWeekKey(wk.weekStart)}
                  >
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={barH}
                      rx={4}
                      fill="#B5121B"
                      opacity={isSelected ? 1 : 0.8}
                      stroke={isSelected ? '#09090B' : 'none'}
                      strokeWidth={isSelected ? 1.5 : 0}
                    />
                    <text
                      x={x + barW / 2}
                      y={Math.max(padTop + 10, y - 5)}
                      textAnchor="middle"
                      className="fill-zinc-700 dark:fill-zinc-300 text-[10px] font-mono font-semibold"
                    >
                      {wk.totalHours.toFixed(1)}h
                    </text>
                    <text
                      x={x + barW / 2}
                      y={svgHeight - 10}
                      textAnchor="middle"
                      className="fill-zinc-500 text-[9px] font-mono"
                    >
                      {wk.weekStart.slice(5)}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}

          {chartMode === 'monthly' && (
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full min-w-[520px] h-auto select-none"
              role="img"
              aria-label="Monthly working hours analytics"
            >
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const yVal = Math.round(monthlyMaxHours * ratio);
                const y = padTop + plotH - ratio * plotH;
                return (
                  <g key={ratio}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={svgWidth - padRight}
                      y2={y}
                      stroke="currentColor"
                      className="text-zinc-200 dark:text-zinc-800"
                      strokeWidth={1}
                    />
                    <text x={padLeft - 6} y={y + 3} textAnchor="end" className="fill-zinc-400 text-[10px] font-mono">
                      {yVal}h
                    </text>
                  </g>
                );
              })}

              {analytics.monthly.map((mo, idx) => {
                const count = Math.max(1, analytics.monthly.length);
                const slotW = plotW / count;
                const barW = Math.max(18, Math.min(56, slotW * 0.5));
                const x = padLeft + idx * slotW + (slotW - barW) / 2;
                const barH = Math.max(3, (mo.totalHours / monthlyMaxHours) * plotH);
                const y = padTop + plotH - barH;
                const isSelected = activeMonthlyBucket?.month === mo.month;
                return (
                  <g
                    key={mo.month}
                    className="cursor-pointer"
                    onMouseEnter={() => setSelectedMonthKey(mo.month)}
                    onClick={() => setSelectedMonthKey(mo.month)}
                  >
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={barH}
                      rx={4}
                      fill="#18181B"
                      className="dark:fill-zinc-100"
                      opacity={isSelected ? 1 : 0.8}
                      stroke={isSelected ? '#B5121B' : 'none'}
                      strokeWidth={isSelected ? 2 : 0}
                    />
                    <text
                      x={x + barW / 2}
                      y={Math.max(padTop + 10, y - 5)}
                      textAnchor="middle"
                      className="fill-zinc-700 dark:fill-zinc-300 text-[10px] font-mono font-semibold"
                    >
                      {mo.totalHours.toFixed(1)}h
                    </text>
                    <text
                      x={x + barW / 2}
                      y={svgHeight - 10}
                      textAnchor="middle"
                      className="fill-zinc-500 text-[9px] font-mono"
                    >
                      {mo.month}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Interactive Tooltip / Inspector Card */}
        {chartMode === 'daily' && activeDailyPoint && (
          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 grid sm:grid-cols-5 gap-3 text-xs">
            <div>
              <div className="text-[11px] text-zinc-500">Date</div>
              <div className="font-mono font-semibold mt-0.5">{activeDailyPoint.date}</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Punch-In</div>
              <div className="font-mono mt-0.5">
                {formatTimeDisplay(activeDailyPoint.punchInTime, schedule.timezone)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Punch-Out</div>
              <div className="font-mono mt-0.5">
                {formatTimeDisplay(activeDailyPoint.punchOutTime, schedule.timezone)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Working Hours</div>
              <div className="font-mono font-bold text-[#B5121B] dark:text-red-400 mt-0.5">
                {activeDailyPoint.hasValidDuration
                  ? formatMinutesAsHoursLabel(activeDailyPoint.workingMinutes)
                  : '0h 0m (Not counted)'}
              </div>
            </div>
              <div>
              <div className="text-[11px] text-zinc-500">Status</div>
              <div className="font-semibold mt-0.5">
                {activeDailyPoint.status}
                {activeDailyPoint.source === 'approved_regularization' ? ' (Regularized)' : ''}
              </div>
            </div>
          </div>
        )}

        {chartMode === 'weekly' && activeWeeklyBucket && (
          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 grid sm:grid-cols-5 gap-3 text-xs">
            <div>
              <div className="text-[11px] text-zinc-500">Week Period</div>
              <div className="font-mono font-semibold mt-0.5">
                {activeWeeklyBucket.weekStart} → {activeWeeklyBucket.weekEnd}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Total Hours</div>
              <div className="font-mono font-bold text-[#B5121B] mt-0.5">
                {formatMinutesAsHoursLabel(activeWeeklyBucket.totalMinutes)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Avg Daily Hours</div>
              <div className="font-mono mt-0.5">{activeWeeklyBucket.averageDailyHours.toFixed(1)}h</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Days Worked</div>
              <div className="font-mono mt-0.5">{activeWeeklyBucket.daysWorked}</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Late / Missing</div>
              <div className="font-mono mt-0.5">
                {activeWeeklyBucket.lateArrivals} late · {activeWeeklyBucket.missingRecords} missing
              </div>
            </div>
          </div>
        )}

        {chartMode === 'monthly' && activeMonthlyBucket && (
          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 grid sm:grid-cols-5 gap-3 text-xs">
            <div>
              <div className="text-[11px] text-zinc-500">Month</div>
              <div className="font-mono font-semibold mt-0.5">{activeMonthlyBucket.month}</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Total Hours</div>
              <div className="font-mono font-bold text-[#B5121B] mt-0.5">
                {formatMinutesAsHoursLabel(activeMonthlyBucket.totalMinutes)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Avg Daily Hours</div>
              <div className="font-mono mt-0.5">{activeMonthlyBucket.averageDailyHours.toFixed(1)}h</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Days Worked</div>
              <div className="font-mono mt-0.5">{activeMonthlyBucket.daysWorked}</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500">Late / Missing</div>
              <div className="font-mono mt-0.5">
                {activeMonthlyBucket.lateArrivals} late · {activeMonthlyBucket.missingRecords} missing
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Empty state guidance if zero worked days */}
      {analytics.summary.workingDaysRecorded === 0 && (
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>
            No completed punch-in and punch-out attendance records exist for {targetEmployee.fullName} in this date range. Missing or unpunched records are shown accurately as 0h without invented hours.
          </span>
        </div>
      )}

      {/* Weekly Summary Breakdown Table */}
      {!compact && analytics.weekly.length > 0 && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-[#B5121B]" />
              Weekly Hours Breakdown
            </span>
            <span className="text-[11px] font-normal text-zinc-500 inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Monday–Sunday buckets
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                  <th className="py-2.5 px-4">Week</th>
                  <th className="py-2.5 px-4 text-right">Days Worked</th>
                  <th className="py-2.5 px-4 text-right">Total Hours</th>
                  <th className="py-2.5 px-4 text-right">Avg / Day</th>
                  <th className="py-2.5 px-4 text-right">Late</th>
                  <th className="py-2.5 px-4 text-right">Missing / Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {analytics.weekly.map((w) => (
                  <tr key={w.weekStart} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                    <td className="py-2.5 px-4 font-mono">
                      {w.weekStart} → {w.weekEnd}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{w.daysWorked}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                      {formatMinutesAsHoursLabel(w.totalMinutes)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {w.daysWorked > 0 ? `${w.averageDailyHours.toFixed(1)}h` : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{w.lateArrivals}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                      {w.missingRecords + w.incompleteRecords}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
