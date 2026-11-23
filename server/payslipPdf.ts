import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveFontPath(fileName: string, systemFallback: string): string {
  const localCandidates = [
    path.resolve(__dirname, '..', 'fonts', fileName),
    path.resolve(__dirname, 'fonts', fileName),
    path.resolve(process.cwd(), 'fonts', fileName),
    systemFallback,
  ];
  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Required Unicode PDF font not found: ${fileName}`);
}

export function formatPdfCurrency(amount: number, currency: string): string {
  const code = (currency || 'INR').toUpperCase();
  const val = Number(amount || 0);
  if (code === 'INR') {
    const formatted = new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
    return `\u20B9${formatted}`;
  }
  if (code === 'AED') {
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
    return `AED ${formatted}`;
  }
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
  return `${code} ${formatted}`;
}

export function formatMonthLabel(monthStr: string): string {
  const [y, m] = String(monthStr || '').split('-').map(Number);
  if (!y || !m) return String(monthStr || '');
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export interface PayslipPdfInput {
  payslip: {
    employeeName: string;
    employeeCode?: string;
    designation?: string;
    department?: string;
    location?: string;
    currency?: string;
    month: string;
    basicSalary?: number;
    hra?: number;
    otherEarnings?: Array<{ label?: string; amount?: number }>;
    bonus?: number;
    deductions?: Array<{ label?: string; amount?: number }>;
    professionalTax?: number;
    grossEarnings?: number;
    totalDeductions?: number;
    netSalary?: number;
    workingDaysInMonth?: number;
    presentDays?: number;
    leaveDays?: number;
    status?: string;
    notes?: string;
  };
  company?: {
    companyName?: string;
    companyAddress?: string;
    companyPhone?: string;
    companyEmail?: string;
    companyWebsite?: string;
    taxId?: string;
    currency?: string;
  } | null;
  logoDataUrl?: string;
}

export function renderPayslipPdfBuffer({
  payslip,
  company,
  logoDataUrl,
}: PayslipPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const regularFontPath = resolveFontPath(
        'NotoSans-Regular.ttf',
        '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf'
      );
      const boldFontPath = resolveFontPath(
        'NotoSans-Bold.ttf',
        '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf'
      );

      const doc = new PDFDocument({ size: 'A4', margin: 44 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      doc.registerFont('NotoSans', regularFontPath);
      doc.registerFont('NotoSans-Bold', boldFontPath);

      const currency = (payslip.currency || company?.currency || 'INR').toUpperCase();
      const pageWidth = doc.page.width - 88;
      const brandBlack = '#000000';
      const brandRed = '#B5121B';
      const zinc600 = '#52525B';
      const zinc400 = '#A1A1AA';
      const zinc200 = '#E4E4E7';
      const zinc50 = '#F4F4F5';

      // Top Header Banner with TalentGrade Red top accent bar
      doc.rect(0, 0, doc.page.width, 6).fill(brandRed);

      const headerY = 44;
      if (typeof logoDataUrl === 'string' && logoDataUrl.startsWith('data:image/')) {
        try {
          const base64Part = logoDataUrl.split(',')[1];
          if (base64Part) {
            const imgBuf = Buffer.from(base64Part, 'base64');
            doc.image(imgBuf, 44, headerY, { fit: [48, 48] });
          }
        } catch {
          // Fallback to clean geometric TalentGrade mark below
        }
      } else {
        doc.rect(44, headerY, 38, 38).fill(brandBlack);
        doc.rect(44, headerY + 34, 38, 4).fill(brandRed);
        doc.fillColor('#FFFFFF').font('NotoSans-Bold').fontSize(14).text('TG', 44, headerY + 9, {
          width: 38,
          align: 'center',
        });
      }

      const companyLeft = 96;
      doc.fillColor(brandBlack).font('NotoSans-Bold').fontSize(17).text(company?.companyName || 'TalentGrade', companyLeft, headerY);
      doc.fillColor(zinc600).font('NotoSans').fontSize(9);
      const companyMeta = [
        company?.companyAddress,
        [company?.companyPhone, company?.companyEmail].filter(Boolean).join('  |  '),
        [company?.companyWebsite, company?.taxId ? `Reg/Tax ID: ${company.taxId}` : ''].filter(Boolean).join('  |  '),
      ].filter(Boolean);
      companyMeta.forEach((line, idx) => {
        doc.text(String(line), companyLeft, headerY + 23 + idx * 12, { width: 280 });
      });

      // Right Payslip Badge Box
      doc.fillColor(zinc50).roundedRect(44 + pageWidth - 182, headerY, 182, 60, 6).fill();
      doc.strokeColor(zinc200).lineWidth(1).roundedRect(44 + pageWidth - 182, headerY, 182, 60, 6).stroke();
      doc.fillColor(brandRed).font('NotoSans-Bold').fontSize(8.5).text(`PAYSLIP · ${currency}`, 44 + pageWidth - 170, headerY + 9);
      doc.fillColor(brandBlack).font('NotoSans-Bold').fontSize(12.5).text(formatMonthLabel(payslip.month), 44 + pageWidth - 170, headerY + 23);
      doc.fillColor(zinc600).font('NotoSans').fontSize(8.5).text(`Status: ${payslip.status || 'Published'}`, 44 + pageWidth - 170, headerY + 42);

      let y = Math.max(headerY + 78, headerY + 28 + companyMeta.length * 12 + 18);
      doc.moveTo(44, y).lineTo(44 + pageWidth, y).strokeColor(zinc200).lineWidth(1).stroke();
      y += 16;

      // Employee Summary Grid
      doc.fillColor(zinc50).roundedRect(44, y, pageWidth, 100, 6).fill();
      doc.strokeColor(zinc200).roundedRect(44, y, pageWidth, 100, 6).stroke();

      const col1X = 58;
      const col2X = 44 + pageWidth / 2 + 12;
      const drawMetaPair = (x: number, rowY: number, label: string, val: string) => {
        doc.fillColor(zinc600).font('NotoSans').fontSize(8.5).text(label, x, rowY);
        doc.fillColor(brandBlack).font('NotoSans-Bold').fontSize(9.5).text(val || '—', x + 95, rowY, {
          width: pageWidth / 2 - 115,
        });
      };

      drawMetaPair(col1X, y + 14, 'Employee Name', String(payslip.employeeName));
      drawMetaPair(col1X, y + 34, 'Employee ID', String(payslip.employeeCode || '—'));
      drawMetaPair(col1X, y + 54, 'Department', String(payslip.department || '—'));
      drawMetaPair(col1X, y + 74, 'Location', String(payslip.location || 'India'));

      drawMetaPair(col2X, y + 14, 'Designation', String(payslip.designation || '—'));
      drawMetaPair(col2X, y + 34, 'Pay Currency', currency === 'INR' ? 'INR (\u20B9)' : currency);
      drawMetaPair(col2X, y + 54, 'Working Days', `${payslip.workingDaysInMonth ?? 0} days`);
      drawMetaPair(col2X, y + 74, 'Present / Leave', `${payslip.presentDays ?? 0} present  ·  ${payslip.leaveDays ?? 0} leave`);

      y += 120;

      // Earnings & Deductions Two-Column Table
      const halfWidth = (pageWidth - 16) / 2;
      const leftX = 44;
      const rightX = 44 + halfWidth + 16;

      doc.fillColor(brandBlack).roundedRect(leftX, y, halfWidth, 26, 4).fill();
      doc.fillColor('#FFFFFF').font('NotoSans-Bold').fontSize(9.5).text('EARNINGS', leftX + 12, y + 7);
      doc.text('AMOUNT', leftX + halfWidth - 102, y + 7, { width: 90, align: 'right' });

      doc.fillColor(brandBlack).roundedRect(rightX, y, halfWidth, 26, 4).fill();
      doc.fillColor('#FFFFFF').font('NotoSans-Bold').fontSize(9.5).text('DEDUCTIONS', rightX + 12, y + 7);
      doc.text('AMOUNT', rightX + halfWidth - 102, y + 7, { width: 90, align: 'right' });

      const earningsRows: { label: string; amount: number }[] = [
        { label: 'Basic Salary', amount: Number(payslip.basicSalary || 0) },
        { label: 'House Rent Allowance (HRA)', amount: Number(payslip.hra || 0) },
      ];
      if (Array.isArray(payslip.otherEarnings)) {
        for (const item of payslip.otherEarnings) {
          earningsRows.push({ label: String(item.label || 'Other Earning'), amount: Number(item.amount || 0) });
        }
      }
      if (Number(payslip.bonus || 0) > 0) {
        earningsRows.push({ label: 'Bonus / Incentives', amount: Number(payslip.bonus || 0) });
      }

      const deductionRows: { label: string; amount: number }[] = [
        { label: 'Professional / Statutory Tax', amount: Number(payslip.professionalTax || 0) },
      ];
      if (Array.isArray(payslip.deductions)) {
        for (const item of payslip.deductions) {
          deductionRows.push({ label: String(item.label || 'Deduction'), amount: Number(item.amount || 0) });
        }
      }

      const rowCount = Math.max(earningsRows.length, deductionRows.length, 3);
      let tableY = y + 32;

      for (let i = 0; i < rowCount; i++) {
        const eRow = earningsRows[i];
        const dRow = deductionRows[i];
        if (i % 2 === 1) {
          doc.fillColor(zinc50).rect(leftX, tableY - 4, halfWidth, 22).fill();
          doc.fillColor(zinc50).rect(rightX, tableY - 4, halfWidth, 22).fill();
        }
        if (eRow) {
          doc.fillColor(brandBlack).font('NotoSans').fontSize(9).text(eRow.label, leftX + 12, tableY, { width: halfWidth - 126 });
          doc.font('NotoSans-Bold').text(formatPdfCurrency(eRow.amount, currency), leftX + halfWidth - 114, tableY, { width: 102, align: 'right' });
        }
        if (dRow) {
          doc.fillColor(brandBlack).font('NotoSans').fontSize(9).text(dRow.label, rightX + 12, tableY, { width: halfWidth - 126 });
          doc.font('NotoSans-Bold').text(formatPdfCurrency(dRow.amount, currency), rightX + halfWidth - 114, tableY, { width: 102, align: 'right' });
        }
        tableY += 22;
      }

      // Totals Row
      tableY += 6;
      doc.moveTo(leftX, tableY).lineTo(leftX + halfWidth, tableY).strokeColor(zinc200).stroke();
      doc.moveTo(rightX, tableY).lineTo(rightX + halfWidth, tableY).strokeColor(zinc200).stroke();
      tableY += 10;

      doc.fillColor(zinc600).font('NotoSans-Bold').fontSize(9.5).text('Gross Earnings', leftX + 12, tableY);
      doc.fillColor(brandBlack).text(formatPdfCurrency(Number(payslip.grossEarnings || 0), currency), leftX + halfWidth - 114, tableY, { width: 102, align: 'right' });

      doc.fillColor(zinc600).font('NotoSans-Bold').fontSize(9.5).text('Total Deductions', rightX + 12, tableY);
      doc.fillColor(brandBlack).text(formatPdfCurrency(Number(payslip.totalDeductions || 0), currency), rightX + halfWidth - 114, tableY, { width: 102, align: 'right' });

      tableY += 34;

      // Net Salary Box
      doc.fillColor(brandBlack).roundedRect(44, tableY, pageWidth, 64, 8).fill();
      doc.fillColor(brandRed).rect(44, tableY + 58, pageWidth, 6).fill();
      doc.fillColor('#E4E4E7').font('NotoSans-Bold').fontSize(9.5).text('NET PAYABLE SALARY', 60, tableY + 14);
      doc.fillColor('#A1A1AA').font('NotoSans').fontSize(8.5).text(
        `Paid in ${currency === 'INR' ? 'INR (\u20B9)' : currency} · Manual Payroll Statement`,
        60,
        tableY + 32
      );
      doc.fillColor('#FFFFFF').font('NotoSans-Bold').fontSize(18.5).text(
        formatPdfCurrency(Number(payslip.netSalary || 0), currency),
        44 + pageWidth - 246,
        tableY + 18,
        { width: 230, align: 'right' }
      );

      tableY += 86;
      if (payslip.notes) {
        doc.fillColor(zinc600).font('NotoSans-Bold').fontSize(9).text('Payroll Notes:', 44, tableY);
        doc.fillColor(brandBlack).font('NotoSans').fontSize(9).text(String(payslip.notes), 44, tableY + 14, { width: pageWidth });
        tableY += 42;
      }

      // Footer
      const footerY = doc.page.height - 84;
      doc.moveTo(44, footerY).lineTo(44 + pageWidth, footerY).strokeColor(zinc200).stroke();
      doc.fillColor(zinc400).font('NotoSans').fontSize(8).text(
        `TalentGrade Confidential Payslip · ${payslip.employeeName} (${payslip.employeeCode || ''}) · Generated on ${new Date().toISOString().slice(0, 10)}.`,
        44,
        footerY + 12,
        { width: pageWidth, align: 'center' }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
