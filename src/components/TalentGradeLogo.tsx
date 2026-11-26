import React from 'react';
import { CompanyId, normalizeCompanyId } from '../types/hr';

interface TalentGradeLogoProps {
  logoUrl?: string | null;
  companyId?: CompanyId;
  companyName?: string;
  compact?: boolean;
  showWordmark?: boolean;
}

export function TalentGradeLogo({
  logoUrl,
  companyId = 'talentgrade',
  companyName,
  compact = false,
  showWordmark = true,
}: TalentGradeLogoProps) {
  const normalized = normalizeCompanyId(companyId);
  const resolvedLabel = companyName || (normalized === 'mygrade' ? 'MyGrade' : 'TalentGrade');
  const isDefaultTgWordmark =
    normalized === 'talentgrade' &&
    (!companyName ||
      companyName.trim().toLowerCase() === 'talentgrade' ||
      companyName.trim().toLowerCase() === 'talentgrade hr services pvt ltd');
  const isDefaultMgWordmark =
    normalized === 'mygrade' &&
    (!companyName ||
      companyName.trim().toLowerCase() === 'mygrade' ||
      companyName.trim().toLowerCase() === 'mygrade learning pvt ltd');

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={resolvedLabel}
          className="w-8 h-8 rounded-lg object-cover border border-zinc-200 dark:border-zinc-700 shrink-0 bg-white"
          referrerPolicy="no-referrer"
        />
      ) : normalized === 'mygrade' ? (
        <svg
          width="32"
          height="32"
          viewBox="0 0 36 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="MyGrade logo"
          className="shrink-0"
        >
          <rect width="36" height="36" rx="8" fill="#000000" />
          <path
            d="M8.5 24V11H12.4L18 18.8L23.6 11H27.5V24H23.9V16.2L19.1 22.7H16.9L12.1 16.2V24H8.5Z"
            fill="#FFFFFF"
          />
          <rect x="8.5" y="27" width="19" height="3" rx="1" fill="#B5121B" />
        </svg>
      ) : (
        <svg
          width="32"
          height="32"
          viewBox="0 0 36 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="TalentGrade logo"
          className="shrink-0"
        >
          <rect width="36" height="36" rx="8" fill="#000000" />
          <path d="M9 11H27V15H20V25H16V15H9V11Z" fill="#FFFFFF" />
          <rect x="9" y="27" width="18" height="3" rx="1" fill="#B5121B" />
        </svg>
      )}
      {!compact && showWordmark && (
        <span className="font-display font-bold text-base tracking-tight whitespace-nowrap truncate">
          {isDefaultTgWordmark ? (
            <>
              <span className="text-zinc-950 dark:text-white">Talent</span>
              <span className="text-[#B5121B]">Grade</span>
            </>
          ) : isDefaultMgWordmark ? (
            <>
              <span className="text-zinc-950 dark:text-white">My</span>
              <span className="text-[#B5121B]">Grade</span>
            </>
          ) : (
            <span className="text-zinc-950 dark:text-white">{resolvedLabel}</span>
          )}
        </span>
      )}
    </div>
  );
}
