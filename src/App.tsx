/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './components/Toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppShell } from './components/AppShell';
import { LoginView } from './views/LoginView';
import { DashboardView } from './views/DashboardView';
import { AttendanceView } from './views/AttendanceView';
import { LeavesView } from './views/LeavesView';
import { EmployeesView } from './views/EmployeesView';
import { PayrollView } from './views/PayrollView';
import { ReportsView } from './views/ReportsView';
import { SettingsView } from './views/SettingsView';
import { CelebrationsView } from './views/CelebrationsView';
import { ExpensesView } from './views/ExpensesView';
import { AssetsView } from './views/AssetsView';
import { CelebrationProvider } from './context/CelebrationContext';
import { HrNotificationProvider } from './context/HrNotificationContext';
import { CelebrationWishModal } from './components/CelebrationWishModal';
import { AppPage } from './types/hr';

const VALID_PAGES = new Set<AppPage>([
  'dashboard',
  'attendance',
  'leaves',
  'expenses',
  'assets',
  'employees',
  'payroll',
  'celebrations',
  'reports',
  'settings',
]);

function resolveInitialPage(): AppPage {
  if (typeof window === 'undefined') return 'dashboard';
  const param = new URLSearchParams(window.location.search).get('page') as AppPage | null;
  if (param && VALID_PAGES.has(param)) {
    return param;
  }
  return 'dashboard';
}

function AppRouter() {
  const { employee, loading } = useAuth();
  const [activePage, setActivePage] = useState<AppPage>(() => resolveInitialPage());

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'NAVIGATE_ATTENDANCE') {
        setActivePage('attendance');
      }
    };
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 gap-3">
        <Loader2 className="w-7 h-7 animate-spin text-[#B5121B]" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Loading TalentGrade workspace...</p>
      </div>
    );
  }

  if (!employee) {
    return <LoginView />;
  }

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return <DashboardView onNavigate={setActivePage} />;
      case 'attendance':
        return <AttendanceView onNavigate={setActivePage} />;
      case 'leaves':
        return <LeavesView />;
      case 'expenses':
        return <ExpensesView />;
      case 'assets':
        return <AssetsView />;
      case 'employees':
        return employee.role === 'employee' ? <DashboardView onNavigate={setActivePage} /> : <EmployeesView />;
      case 'payroll':
        return <PayrollView />;
      case 'celebrations':
        return <CelebrationsView />;
      case 'reports':
        return employee.role === 'employee' ? <DashboardView onNavigate={setActivePage} /> : <ReportsView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <DashboardView onNavigate={setActivePage} />;
    }
  };

  return (
    <>
      <CelebrationWishModal />
      <AppShell activePage={activePage} onNavigate={setActivePage}>
        {renderPage()}
      </AppShell>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <CelebrationProvider>
              <HrNotificationProvider>
                <AppRouter />
              </HrNotificationProvider>
            </CelebrationProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
