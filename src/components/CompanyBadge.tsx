import React from 'react';
import { CompanyId, getCompanyShortName, normalizeCompanyId } from '../types/hr';

interface CompanyBadgeProps {
  companyId?: CompanyId | string | null;
  showLegalName?: boolean;
  className?: string;
}

export function CompanyBadge({
  companyId,
  showLegalName = false,
  className = '',
}: CompanyBadgeProps) {
  const normalized = normalizeCompanyId(companyId);
  const label = showLegalName
    ? normalized === 'mygrade'
      ? 'MyGrade Learning Pvt Ltd'
      : 'TalentGrade HR Services Pvt Ltd'
    : getCompanyShortName(normalized);

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-tight border whitespace-nowrap ${
        normalized === 'mygrade'
          ? 'bg-red-50 dark:bg-red-950/35 text-[#B5121B] dark:text-red-300 border-red-200 dark:border-red-900/60'
          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border-zinc-200 dark:border-zinc-700'
      } ${className}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-sm shrink-0 ${
          normalized === 'mygrade' ? 'bg-[#B5121B]' : 'bg-zinc-900 dark:bg-white'
        }`}
      />
      <span>{label}</span>
    </span>
  );
}
