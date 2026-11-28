export type CompanyId = 'talentgrade' | 'mygrade';

export const COMPANY_IDS: readonly CompanyId[] = ['talentgrade', 'mygrade'] as const;

export type SupportedCurrency = 'INR' | 'AED';

export interface CompanyProfileConfig {
  id: CompanyId;
  shortName: string;
  legalName: string;
  address: string;
  phone?: string;
  email?: string;
  website?: string;
  taxId?: string;
  logoAssetId?: string;
  supportedCurrencies: SupportedCurrency[];
  defaultCurrency: SupportedCurrency;
}

export interface CompanyIdentityOverride {
  companyId?: CompanyId;
  companyName?: string;
  companyAddress?: string;
  companyLogoAssetId?: string;
  companyOverridden?: boolean;
}

export interface ResolvedCompanyIdentity {
  companyId: CompanyId;
  shortName: string;
  legalName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
  logoAssetId: string;
  supportedCurrencies: SupportedCurrency[];
  defaultCurrency: SupportedCurrency;
  isOverridden: boolean;
}

export const DEFAULT_COMPANY_ADDRESS =
  '61, 2nd Floor, Koramangala 7th Block, Bangalore, Karnataka - 560095';

export const DEFAULT_COMPANIES: Record<CompanyId, CompanyProfileConfig> = {
  talentgrade: {
    id: 'talentgrade',
    shortName: 'TalentGrade',
    legalName: 'TalentGrade HR Services Pvt Ltd',
    address: DEFAULT_COMPANY_ADDRESS,
    phone: '',
    email: '',
    website: 'https://talentgrade.io',
    taxId: '',
    logoAssetId: '',
    supportedCurrencies: ['INR', 'AED'],
    defaultCurrency: 'INR',
  },
  mygrade: {
    id: 'mygrade',
    shortName: 'MyGrade',
    legalName: 'MyGrade Learning Pvt Ltd',
    address: DEFAULT_COMPANY_ADDRESS,
    phone: '',
    email: '',
    website: '',
    taxId: '',
    logoAssetId: '',
    supportedCurrencies: ['INR'],
    defaultCurrency: 'INR',
  },
};

export function isValidCompanyId(value: unknown): value is CompanyId {
  return value === 'talentgrade' || value === 'mygrade';
}

export function normalizeCompanyId(value?: string | null): CompanyId {
  if (value === 'mygrade') return 'mygrade';
  return 'talentgrade';
}

export function getCompanyShortName(companyId?: string | null): string {
  return normalizeCompanyId(companyId) === 'mygrade' ? 'MyGrade' : 'TalentGrade';
}

export function getAllowedCurrenciesForCompany(companyId?: string | null): SupportedCurrency[] {
  return normalizeCompanyId(companyId) === 'mygrade' ? ['INR'] : ['INR', 'AED'];
}

export function isCurrencyAllowedForCompany(
  companyId?: string | null,
  currency?: string | null
): boolean {
  const code = String(currency || 'INR').trim().toUpperCase();
  const allowed = getAllowedCurrenciesForCompany(companyId);
  return allowed.includes(code as SupportedCurrency);
}

export function enforceCompanyCurrency(
  companyId?: string | null,
  requestedCurrency?: string | null
): SupportedCurrency {
  const normalizedCompany = normalizeCompanyId(companyId);
  if (normalizedCompany === 'mygrade') {
    return 'INR';
  }
  const code = String(requestedCurrency || 'INR').trim().toUpperCase();
  return code === 'AED' ? 'AED' : 'INR';
}

export function assertCurrencyAllowedForCompany(
  companyId?: string | null,
  currency?: string | null
): SupportedCurrency {
  const normalizedCompany = normalizeCompanyId(companyId);
  const code = String(currency || 'INR').trim().toUpperCase();
  if (normalizedCompany === 'mygrade' && code !== 'INR') {
    throw new Error(
      'MyGrade Learning Pvt Ltd only supports INR payslips. AED currency cannot be assigned to MyGrade employees.'
    );
  }
  if (code !== 'INR' && code !== 'AED') {
    throw new Error(`Unsupported currency "${code}". Supported currencies are INR and AED.`);
  }
  return code as SupportedCurrency;
}

export interface SettingsLikeForCompanies {
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  taxId?: string;
  logoAssetId?: string;
  currency?: string;
  companies?: Partial<Record<CompanyId, Partial<CompanyProfileConfig>>>;
}

export function normalizeCompaniesMap(
  settings?: SettingsLikeForCompanies | null
): Record<CompanyId, CompanyProfileConfig> {
  const rawTg = settings?.companies?.talentgrade;
  const rawMg = settings?.companies?.mygrade;

  // Migrate legacy single-company address cleanly only if it isn't the old generic placeholder
  const legacyAddress =
    settings?.companyAddress &&
    settings.companyAddress.trim() &&
    settings.companyAddress.trim() !== 'India & Dubai, UAE Operations'
      ? settings.companyAddress.trim()
      : DEFAULT_COMPANIES.talentgrade.address;

  const legacyTgLegalName =
    rawTg?.legalName?.trim() ||
    (settings?.companyName &&
    settings.companyName.trim() &&
    settings.companyName.trim() !== 'TalentGrade' &&
    settings.companyName.trim() !== 'Meridian Internal Operations'
      ? settings.companyName.trim()
      : DEFAULT_COMPANIES.talentgrade.legalName);

  const talentgrade: CompanyProfileConfig = {
    id: 'talentgrade',
    shortName: rawTg?.shortName?.trim() || DEFAULT_COMPANIES.talentgrade.shortName,
    legalName: legacyTgLegalName,
    address: rawTg?.address?.trim() || legacyAddress,
    phone: rawTg?.phone ?? settings?.companyPhone ?? '',
    email: rawTg?.email ?? settings?.companyEmail ?? '',
    website: rawTg?.website ?? settings?.companyWebsite ?? DEFAULT_COMPANIES.talentgrade.website,
    taxId: rawTg?.taxId ?? settings?.taxId ?? '',
    logoAssetId: rawTg?.logoAssetId ?? settings?.logoAssetId ?? '',
    supportedCurrencies: ['INR', 'AED'],
    defaultCurrency: rawTg?.defaultCurrency === 'AED' ? 'AED' : 'INR',
  };

  const mygrade: CompanyProfileConfig = {
    id: 'mygrade',
    shortName: rawMg?.shortName?.trim() || DEFAULT_COMPANIES.mygrade.shortName,
    legalName: rawMg?.legalName?.trim() || DEFAULT_COMPANIES.mygrade.legalName,
    address: rawMg?.address?.trim() || DEFAULT_COMPANIES.mygrade.address,
    phone: rawMg?.phone ?? '',
    email: rawMg?.email ?? '',
    website: rawMg?.website ?? '',
    taxId: rawMg?.taxId ?? '',
    logoAssetId: rawMg?.logoAssetId ?? '',
    // Strictly INR only for MyGrade
    supportedCurrencies: ['INR'],
    defaultCurrency: 'INR',
  };

  return { talentgrade, mygrade };
}

export function resolveCompanyProfile(
  companyId?: string | null,
  settings?: SettingsLikeForCompanies | null,
  override?: CompanyIdentityOverride | null
): ResolvedCompanyIdentity {
  const effectiveCompanyId = normalizeCompanyId(override?.companyId || companyId);
  const map = normalizeCompaniesMap(settings);
  const base = map[effectiveCompanyId];
  const isOverridden = Boolean(override?.companyOverridden);

  const resolvedLogoAssetId = isOverridden
    ? typeof override?.companyLogoAssetId === 'string'
      ? override.companyLogoAssetId.trim()
      : base.logoAssetId || ''
    : typeof override?.companyLogoAssetId === 'string' && override.companyLogoAssetId.trim()
      ? override.companyLogoAssetId.trim()
      : base.logoAssetId || '';

  return {
    companyId: effectiveCompanyId,
    shortName: base.shortName,
    legalName: override?.companyName?.trim() || base.legalName,
    address: override?.companyAddress?.trim() || base.address,
    phone: base.phone || '',
    email: base.email || '',
    website: base.website || '',
    taxId: base.taxId || '',
    logoAssetId: resolvedLogoAssetId,
    supportedCurrencies: getAllowedCurrenciesForCompany(effectiveCompanyId),
    defaultCurrency: base.defaultCurrency,
    isOverridden,
  };
}

const PDF_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatPayslipPdfFilename(payslip: {
  month?: string | null;
  employeeName?: string | null;
  employeeCode?: string | null;
}): string {
  const rawMonth = String(payslip?.month || '').trim();
  const match = /^(\d{4})-(\d{1,2})$/.exec(rawMonth);
  let periodSegment = 'Payslip';
  if (match) {
    const year = match[1];
    const monthNum = Number(match[2]);
    const monthName =
      monthNum >= 1 && monthNum <= 12 ? PDF_MONTH_NAMES[monthNum - 1] : `M${String(monthNum).padStart(2, '0')}`;
    periodSegment = `${monthName}_${year}`;
  } else if (rawMonth) {
    periodSegment = rawMonth.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Period';
  }

  const rawName = String(payslip?.employeeName || payslip?.employeeCode || 'Employee').trim();
  const safeName =
    rawName
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Employee';

  return `Payslip_${periodSegment}_${safeName}.pdf`;
}

