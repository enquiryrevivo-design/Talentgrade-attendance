import React from 'react';

interface TalentGradeLogoProps {
  logoUrl?: string | null;
  companyName?: string;
  compact?: boolean;
}

export function TalentGradeLogo({
  logoUrl,
  companyName = 'TalentGrade',
  compact = false,
}: TalentGradeLogoProps) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={companyName}
          className="w-8 h-8 rounded-lg object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
          referrerPolicy="no-referrer"
        />
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
      {!compact && (
        <span className="font-display font-bold text-base tracking-tight text-zinc-950 dark:text-white whitespace-nowrap truncate">
          {companyName}
        </span>
      )}
    </div>
  );
}
