import React, { useState } from 'react';
import {
  LayoutDashboard,
  Clock,
  CalendarDays,
  Users,
  Receipt,
  BarChart3,
  Settings,
  Sun,
  Moon,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { AppPage, UserRole } from '../types/hr';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { TalentGradeLogo } from './TalentGradeLogo';

interface NavItem {
  id: AppPage;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['super_admin', 'team_leader', 'employee'] },
  { id: 'attendance', label: 'Attendance', icon: Clock, roles: ['super_admin', 'team_leader', 'employee'] },
  { id: 'leaves', label: 'Leaves', icon: CalendarDays, roles: ['super_admin', 'team_leader', 'employee'] },
  { id: 'employees', label: 'Employees', icon: Users, roles: ['super_admin', 'team_leader'] },
  { id: 'payroll', label: 'Payroll', icon: Receipt, roles: ['super_admin', 'employee', 'team_leader'] },
  { id: 'reports', label: 'Reports', icon: BarChart3, roles: ['super_admin', 'team_leader'] },
  { id: 'settings', label: 'Settings', icon: Settings, roles: ['super_admin'] },
];

interface AppShellProps {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  children: React.ReactNode;
}

export function AppShell({ activePage, onNavigate, children }: AppShellProps) {
  const { employee, settings, companyLogoUrl, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!employee) return null;

  const allowedNav = NAV_ITEMS.filter((item) => {
    if (item.id === 'payroll' && employee.role === 'team_leader' && !settings?.teamLeaderPermissions?.canViewSalary) {
      return true;
    }
    return item.roles.includes(employee.role);
  }).map((item) => {
    if (item.id === 'payroll' && employee.role !== 'super_admin') {
      return { ...item, label: 'Payslips' };
    }
    return item;
  });

  const mobilePrimaryTabs = allowedNav.slice(0, 4);
  const mobileOverflowTabs = allowedNav.slice(4);
  const currentTitle = allowedNav.find((n) => n.id === activePage)?.label || 'Dashboard';

  const roleLabel =
    employee.role === 'super_admin'
      ? 'Super Admin'
      : employee.role === 'team_leader'
      ? 'Team Leader'
      : 'Employee';

  const companyName = settings?.companyName || 'TalentGrade';

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-950 dark:text-zinc-100 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 z-30">
        <div className="px-5 py-5 border-b border-zinc-200 dark:border-zinc-800">
          <TalentGradeLogo logoUrl={companyLogoUrl} companyName={companyName} />
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1.5 pl-0.5 truncate">
            {employee.location || 'India'} · Internal Operations
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {allowedNav.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-zinc-950 text-white dark:bg-white dark:text-black'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 hover:text-zinc-950 dark:hover:text-zinc-100'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#B5121B] dark:text-[#B5121B]' : ''}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="flex items-center gap-3 px-1">
            <div className="w-9 h-9 rounded-full bg-black text-white dark:bg-zinc-800 dark:text-zinc-100 flex items-center justify-center text-xs font-semibold shrink-0">
              {employee.fullName
                .split(' ')
                .map((p) => p[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-zinc-950 dark:text-zinc-100 truncate">{employee.fullName}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                {employee.employeeCode} · {roleLabel}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="flex-1 min-h-[40px] flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              {theme === 'light' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
              <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
            </button>
            <button
              onClick={logout}
              className="flex-1 min-h-[40px] flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-red-50 hover:text-[#B5121B] dark:hover:bg-red-950/40 dark:hover:text-red-300"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Compact Sticky Header (52px) */}
      <header className="lg:hidden sticky top-0 z-30 h-13 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800 px-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <TalentGradeLogo logoUrl={companyLogoUrl} companyName={companyName} compact />
          <span className="font-display font-semibold text-sm truncate">{currentTitle}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-300"
          >
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open menu"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-600 dark:text-zinc-300"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 lg:pl-64 pb-20 lg:pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7">{children}</div>
      </main>

      {/* Mobile Fixed Bottom Tab Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-t border-zinc-200 dark:border-zinc-800 pb-safe">
        <div className={`grid ${mobileOverflowTabs.length > 0 ? 'grid-cols-5' : `grid-cols-${mobilePrimaryTabs.length}`} h-16 items-center`}>
          {mobilePrimaryTabs.map((item) => {
            const Icon = item.icon;
            const active = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                  active ? 'text-[#B5121B] dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="truncate max-w-[68px]">{item.label}</span>
              </button>
            );
          })}
          {mobileOverflowTabs.length > 0 && (
            <button
              onClick={() => setMobileMenuOpen(true)}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                mobileOverflowTabs.some((t) => t.id === activePage)
                  ? 'text-[#B5121B] dark:text-red-400'
                  : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <Menu className="w-5 h-5" />
              <span>More</span>
            </button>
          )}
        </div>
      </nav>

      {/* Mobile Slide-Up Menu Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end">
          <div className="w-full bg-white dark:bg-zinc-900 rounded-t-3xl border-t border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm text-zinc-950 dark:text-zinc-100">{employee.fullName}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {employee.employeeCode} · {roleLabel} · {employee.location || 'India'}
                </div>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {allowedNav.map((item) => {
                const Icon = item.icon;
                const active = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onNavigate(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`min-h-[48px] flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-sm font-medium ${
                      active
                        ? 'border-[#B5121B] bg-[#B5121B]/10 text-[#B5121B] dark:text-red-300'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => {
                setMobileMenuOpen(false);
                logout();
              }}
              className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl border border-red-200 dark:border-red-900 text-[#B5121B] dark:text-red-400 text-sm font-medium"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
