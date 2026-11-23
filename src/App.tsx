/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './components/Toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppShell } from './components/AppShell';
import { ForcePasswordChangeModal, LoginView } from './views/LoginView';
import { DashboardView } from './views/DashboardView';
import { AttendanceView } from './views/AttendanceView';
import { LeavesView } from './views/LeavesView';
import { EmployeesView } from './views/EmployeesView';
import { PayrollView } from './views/PayrollView';
import { ReportsView } from './views/ReportsView';
import { SettingsView } from './views/SettingsView';
import { AppPage } from './types/hr';

function AppRouter() {
  const { employee, loading } = useAuth();
  const [activePage, setActivePage] = useState<AppPage>('dashboard');

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
        return <AttendanceView />;
      case 'leaves':
        return <LeavesView />;
      case 'employees':
        return employee.role === 'employee' ? <DashboardView onNavigate={setActivePage} /> : <EmployeesView />;
      case 'payroll':
        return <PayrollView />;
      case 'reports':
        return employee.role === 'employee' ? <DashboardView onNavigate={setActivePage} /> : <ReportsView />;
      case 'settings':
        return employee.role === 'super_admin' ? <SettingsView /> : <DashboardView onNavigate={setActivePage} />;
      default:
        return <DashboardView onNavigate={setActivePage} />;
    }
  };

  return (
    <>
      <ForcePasswordChangeModal />
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
            <AppRouter />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
