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

      const margin = 44;
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 38, left: margin, right: margin, bottom: 20 },
        info: {
          Title: `${company?.companyName || 'TalentGrade'} Payslip - ${payslip.employeeName} - ${payslip.month}`,
          Author: company?.companyName || 'TalentGrade',
          Subject: `Monthly Payroll Statement (${formatMonthLabel(payslip.month)})`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('error', (err) => reject(err));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      doc.registerFont('NotoSans', regularFontPath);
      doc.registerFont('NotoSans-Bold', boldFontPath);

      const currency = (payslip.currency || company?.currency || 'INR').toUpperCase();
      const currencyDisplay = currency === 'INR' ? 'INR (\u20B9)' : currency;
      const currencySubtitle =
        currency === 'INR'
          ? 'Indian Rupees (INR)'
          : currency === 'AED'
            ? 'UAE Dirhams (AED)'
            : currency;

      const pageWidth = doc.page.width - margin * 2;
      const pureBlack = '#000000';
      const inkBlack = '#111111';
      const brandRed = '#B5121B';
      const charcoal = '#3F3F46';
      const muted = '#52525B';
      const lightMuted = '#71717A';
      const ruleDark = '#27272A';
      const ruleMid = '#D4D4D8';
      const ruleLight = '#E4E4E7';

      const companyName = (company?.companyName || 'TalentGrade').trim() || 'TalentGrade';

      // =========================================================================
      // 1. HEADER: Left Brand + Company Info | Right Payslip Title, Month & Status
      // =========================================================================
      const headerTop = 38;
      let hasLogoImage = false;
      const logoSize = 38;

      if (
        typeof logoDataUrl === 'string' &&
        /^data:image\/(png|jpeg|jpg);base64,/i.test(logoDataUrl)
      ) {
        try {
          const base64Part = logoDataUrl.split(',')[1];
          if (base64Part) {
            const imgBuf = Buffer.from(base64Part, 'base64');
            doc.image(imgBuf, margin, headerTop + 2, { fit: [logoSize, logoSize] });
            hasLogoImage = true;
          }
        } catch {
          hasLogoImage = false;
        }
      }

      const brandLeft = hasLogoImage ? margin + logoSize + 12 : margin;
      const rightColWidth = 175;
      const leftColWidth = pageWidth - rightColWidth - 20 - (hasLogoImage ? logoSize + 12 : 0);

      // Typographic wordmark (or uploaded logo + company name) with restrained red accent
      doc
        .fillColor(pureBlack)
        .font('NotoSans-Bold')
        .fontSize(20)
        .text(companyName, brandLeft, headerTop, { width: leftColWidth });

      const titleHeight = doc.heightOfString(companyName, { width: leftColWidth });
      let leftCursorY = headerTop + titleHeight + 4;

      if (!hasLogoImage) {
        // Tasteful small TalentGrade red brand accent bar beneath typographic wordmark
        doc.rect(brandLeft, leftCursorY, 24, 2.2).fill(brandRed);
        leftCursorY += 9;
      } else {
        leftCursorY += 3;
      }

      // Compact company details directly beneath company name
      const companyMetaLines = [
        company?.companyAddress?.trim(),
        [company?.companyPhone?.trim(), company?.companyEmail?.trim()].filter(Boolean).join('  ·  '),
        [
          company?.companyWebsite?.trim(),
          company?.taxId?.trim() ? `Reg / Tax ID: ${company.taxId.trim()}` : '',
        ]
          .filter(Boolean)
          .join('  ·  '),
      ].filter((line): line is string => Boolean(line));

      doc.font('NotoSans').fontSize(8.2).fillColor(muted);
      for (const line of companyMetaLines) {
        const lineH = doc.heightOfString(line, { width: leftColWidth, lineGap: 1.5 });
        doc.text(line, brandLeft, leftCursorY, { width: leftColWidth, lineGap: 1.5 });
        leftCursorY += lineH + 2.5;
      }

      if (hasLogoImage) {
        leftCursorY = Math.max(leftCursorY, headerTop + logoSize + 6);
      }

      // Right Header: PAYSLIP title, payroll month, and discreet status
      const headerRightX = margin + pageWidth - rightColWidth;
      doc
        .fillColor(brandRed)
        .font('NotoSans-Bold')
        .fontSize(8.5)
        .text('PAYSLIP', headerRightX, headerTop + 2, {
          width: rightColWidth,
          align: 'right',
          characterSpacing: 1.4,
        });

      const monthText = formatMonthLabel(payslip.month);
      doc
        .fillColor(pureBlack)
        .font('NotoSans-Bold')
        .fontSize(15)
        .text(monthText, headerRightX, headerTop + 16, {
          width: rightColWidth,
          align: 'right',
        });

      const monthHeight = doc.heightOfString(monthText, { width: rightColWidth });
      const statusText = `Status: ${payslip.status || 'Published'}`;
      const statusY = headerTop + 16 + monthHeight + 4;
      doc
        .fillColor(muted)
        .font('NotoSans')
        .fontSize(8.5)
        .text(statusText, headerRightX, statusY, {
          width: rightColWidth,
          align: 'right',
        });

      const rightBottomY = statusY + 13;

      // Thin TalentGrade Red divider line below header
      let y = Math.max(leftCursorY, rightBottomY) + 10;
      doc.moveTo(margin, y).lineTo(margin + pageWidth, y).strokeColor(brandRed).lineWidth(1.1).stroke();
      y += 14;

      // =========================================================================
      // 2. EMPLOYEE INFORMATION SECTION (Clean aligned rows with dynamic wrap)
      // =========================================================================
      doc
        .fillColor(charcoal)
        .font('NotoSans-Bold')
        .fontSize(8.2)
        .text('EMPLOYEE INFORMATION', margin, y, { characterSpacing: 0.9 });
      y += 13;
      doc.moveTo(margin, y).lineTo(margin + pageWidth, y).strokeColor(ruleDark).lineWidth(0.75).stroke();
      y += 8;

      const infoGutter = 24;
      const infoColWidth = (pageWidth - infoGutter) / 2;
      const infoLabelWidth = 94;
      const infoValueWidth = infoColWidth - infoLabelWidth - 6;

      interface MetaCell {
        label: string;
        value: string;
      }

      const formatDays = (val?: number) => {
        const n = Number(val ?? 0);
        return `${n} ${n === 1 ? 'day' : 'days'}`;
      };

      const infoRows: Array<[MetaCell, MetaCell | null]> = [
        [
          { label: 'Employee Name', value: String(payslip.employeeName || '—') },
          { label: 'Employee ID', value: String(payslip.employeeCode || '—') },
        ],
        [
          { label: 'Designation', value: String(payslip.designation || '—') },
          { label: 'Department', value: String(payslip.department || '—') },
        ],
        [
          { label: 'Location / Country', value: String(payslip.location || 'India') },
          { label: 'Pay Currency', value: currencyDisplay },
        ],
        [
          { label: 'Working Days', value: formatDays(payslip.workingDaysInMonth) },
          { label: 'Present Days', value: formatDays(payslip.presentDays) },
        ],
        [
          { label: 'Leave Days', value: formatDays(payslip.leaveDays) },
          null,
        ],
      ];

      infoRows.forEach(([leftCell, rightCell], idx) => {
        doc.font('NotoSans').fontSize(8.5);
        const hLeftLbl = doc.heightOfString(leftCell.label, { width: infoLabelWidth });
        const hRightLbl = rightCell
          ? doc.heightOfString(rightCell.label, { width: infoLabelWidth })
          : 0;

        doc.font('NotoSans-Bold').fontSize(9);
        const hLeftVal = doc.heightOfString(leftCell.value, {
          width: infoValueWidth,
          lineGap: 1.5,
        });
        const hRightVal = rightCell
          ? doc.heightOfString(rightCell.value, { width: infoValueWidth, lineGap: 1.5 })
          : 0;

        const rowContentHeight = Math.max(hLeftLbl, hLeftVal, hRightLbl, hRightVal, 12);

        // Left column cell
        doc
          .fillColor(muted)
          .font('NotoSans')
          .fontSize(8.5)
          .text(leftCell.label, margin, y, { width: infoLabelWidth });
        doc
          .fillColor(inkBlack)
          .font('NotoSans-Bold')
          .fontSize(9)
          .text(leftCell.value, margin + infoLabelWidth + 6, y, {
            width: infoValueWidth,
            lineGap: 1.5,
          });

        // Right column cell
        if (rightCell) {
          const rightColX = margin + infoColWidth + infoGutter;
          doc
            .fillColor(muted)
            .font('NotoSans')
            .fontSize(8.5)
            .text(rightCell.label, rightColX, y, { width: infoLabelWidth });
          doc
            .fillColor(inkBlack)
            .font('NotoSans-Bold')
            .fontSize(9)
            .text(rightCell.value, rightColX + infoLabelWidth + 6, y, {
              width: infoValueWidth,
              lineGap: 1.5,
            });
        }

        y += rowContentHeight + 4.5;

        // Subtle hairline divider between employee info rows
        const isLast = idx === infoRows.length - 1;
        doc
          .moveTo(margin, y)
          .lineTo(margin + pageWidth, y)
          .strokeColor(isLast ? ruleMid : ruleLight)
          .lineWidth(isLast ? 0.75 : 0.5)
          .stroke();

        y += isLast ? 15 : 5.5;
      });

      // =========================================================================
      // 3. EARNINGS & DEDUCTIONS (Two cleanly aligned corporate columns)
      // =========================================================================
      const tableGutter = 24;
      const halfWidth = (pageWidth - tableGutter) / 2;
      const leftX = margin;
      const rightX = margin + halfWidth + tableGutter;
      const amountColWidth = 108;
      const labelColWidth = halfWidth - amountColWidth - 8;

      // Table column headers — minimalist corporate rule style
      doc.fillColor(inkBlack).font('NotoSans-Bold').fontSize(8.2);
      doc.text('EARNINGS', leftX, y, { width: labelColWidth, characterSpacing: 0.9 });
      doc.text('AMOUNT', leftX + halfWidth - amountColWidth, y, {
        width: amountColWidth,
        align: 'right',
        characterSpacing: 0.9,
      });

      doc.text('DEDUCTIONS', rightX, y, { width: labelColWidth, characterSpacing: 0.9 });
      doc.text('AMOUNT', rightX + halfWidth - amountColWidth, y, {
        width: amountColWidth,
        align: 'right',
        characterSpacing: 0.9,
      });

      y += 14;
      doc.moveTo(leftX, y).lineTo(leftX + halfWidth, y).strokeColor(inkBlack).lineWidth(1).stroke();
      doc.moveTo(rightX, y).lineTo(rightX + halfWidth, y).strokeColor(inkBlack).lineWidth(1).stroke();
      y += 8;

      // Assemble configured Earnings (only configured components; never fabricate fake lines)
      interface LineRow {
        label: string;
        amount: number;
        isPlaceholder?: boolean;
      }

      const earningsRows: LineRow[] = [
        { label: 'Basic Salary', amount: Number(payslip.basicSalary || 0) },
      ];
      if (Number(payslip.hra || 0) > 0) {
        earningsRows.push({
          label: 'House Rent Allowance',
          amount: Number(payslip.hra || 0),
        });
      }
      if (Array.isArray(payslip.otherEarnings)) {
        for (const item of payslip.otherEarnings) {
          const amt = Number(item?.amount || 0);
          const lbl = String(item?.label || '').trim();
          if (amt > 0 || (lbl.length > 0 && amt !== 0)) {
            earningsRows.push({ label: lbl || 'Other Allowance', amount: amt });
          }
        }
      }
      if (Number(payslip.bonus || 0) > 0) {
        earningsRows.push({
          label: 'Additional Earnings / Bonus',
          amount: Number(payslip.bonus || 0),
        });
      }

      // Assemble configured Deductions
      const deductionRows: LineRow[] = [];
      if (Number(payslip.professionalTax || 0) > 0) {
        deductionRows.push({
          label: 'Statutory / Professional Tax',
          amount: Number(payslip.professionalTax || 0),
        });
      }
      if (Array.isArray(payslip.deductions)) {
        for (const item of payslip.deductions) {
          const amt = Number(item?.amount || 0);
          const lbl = String(item?.label || '').trim();
          if (amt > 0 || (lbl.length > 0 && amt !== 0)) {
            deductionRows.push({ label: lbl || 'Other Deduction', amount: amt });
          }
        }
      }
      if (deductionRows.length === 0) {
        deductionRows.push({
          label: 'No deductions applicable',
          amount: 0,
          isPlaceholder: true,
        });
      }

      const rowCount = Math.max(earningsRows.length, deductionRows.length);

      for (let i = 0; i < rowCount; i++) {
        const eRow = earningsRows[i];
        const dRow = deductionRows[i];

        doc.font('NotoSans').fontSize(9);
        const eH = eRow ? doc.heightOfString(eRow.label, { width: labelColWidth, lineGap: 1.5 }) : 0;
        const dH = dRow ? doc.heightOfString(dRow.label, { width: labelColWidth, lineGap: 1.5 }) : 0;
        const rowH = Math.max(eH, dH, 13);

        if (eRow) {
          doc
            .fillColor(charcoal)
            .font('NotoSans')
            .fontSize(9)
            .text(eRow.label, leftX, y, { width: labelColWidth, lineGap: 1.5 });
          doc
            .fillColor(inkBlack)
            .font('NotoSans-Bold')
            .fontSize(9)
            .text(formatPdfCurrency(eRow.amount, currency), leftX + halfWidth - amountColWidth, y, {
              width: amountColWidth,
              align: 'right',
            });
        }

        if (dRow) {
          doc
            .fillColor(dRow.isPlaceholder ? lightMuted : charcoal)
            .font('NotoSans')
            .fontSize(9)
            .text(dRow.label, rightX, y, { width: labelColWidth, lineGap: 1.5 });
          doc
            .fillColor(dRow.isPlaceholder ? lightMuted : inkBlack)
            .font(dRow.isPlaceholder ? 'NotoSans' : 'NotoSans-Bold')
            .fontSize(9)
            .text(
              dRow.isPlaceholder ? '—' : formatPdfCurrency(dRow.amount, currency),
              rightX + halfWidth - amountColWidth,
              y,
              {
                width: amountColWidth,
                align: 'right',
              }
            );
        }

        y += rowH + 4.5;
        if (i < rowCount - 1) {
          if (eRow) {
            doc
              .moveTo(leftX, y)
              .lineTo(leftX + halfWidth, y)
              .strokeColor(ruleLight)
              .lineWidth(0.5)
              .stroke();
          }
          if (dRow) {
            doc
              .moveTo(rightX, y)
              .lineTo(rightX + halfWidth, y)
              .strokeColor(ruleLight)
              .lineWidth(0.5)
              .stroke();
          }
          y += 5.5;
        }
      }

      // Column Totals Row (Gross Earnings | Total Deductions)
      y += 3;
      doc.moveTo(leftX, y).lineTo(leftX + halfWidth, y).strokeColor(inkBlack).lineWidth(0.85).stroke();
      doc.moveTo(rightX, y).lineTo(rightX + halfWidth, y).strokeColor(inkBlack).lineWidth(0.85).stroke();
      y += 7;

      const grossEarningsVal = Number(payslip.grossEarnings || 0);
      const totalDeductionsVal = Number(payslip.totalDeductions || 0);
      const netSalaryVal = Number(payslip.netSalary || 0);

      doc.fillColor(inkBlack).font('NotoSans-Bold').fontSize(9.2);
      doc.text('Gross Earnings', leftX, y, { width: labelColWidth });
      doc.text(
        formatPdfCurrency(grossEarningsVal, currency),
        leftX + halfWidth - amountColWidth,
        y,
        { width: amountColWidth, align: 'right' }
      );

      doc.text('Total Deductions', rightX, y, { width: labelColWidth });
      doc.text(
        formatPdfCurrency(totalDeductionsVal, currency),
        rightX + halfWidth - amountColWidth,
        y,
        { width: amountColWidth, align: 'right' }
      );

      y += 15;
      doc.moveTo(leftX, y).lineTo(leftX + halfWidth, y).strokeColor(ruleMid).lineWidth(0.6).stroke();
      doc.moveTo(rightX, y).lineTo(rightX + halfWidth, y).strokeColor(ruleMid).lineWidth(0.6).stroke();

      y += 18;

      // =========================================================================
      // 4. SALARY SUMMARY & PROMINENT NET PAYABLE SALARY
      // =========================================================================
      if (y > doc.page.height - 190) {
        doc.addPage();
        y = 44;
      }

      doc
        .fillColor(charcoal)
        .font('NotoSans-Bold')
        .fontSize(8.2)
        .text('SALARY SUMMARY', margin, y, { characterSpacing: 0.9 });
      y += 13;

      const summaryPadX = 14;
      const summaryRowH = 22;
      const summaryBoxTop = y;

      // Crisp bordered white summary breakdown for Gross & Deductions
      doc
        .rect(margin, summaryBoxTop, pageWidth, summaryRowH * 2)
        .lineWidth(0.75)
        .strokeColor(ruleMid)
        .stroke();

      doc
        .moveTo(margin, summaryBoxTop + summaryRowH)
        .lineTo(margin + pageWidth, summaryBoxTop + summaryRowH)
        .strokeColor(ruleLight)
        .lineWidth(0.5)
        .stroke();

      doc.fillColor(muted).font('NotoSans').fontSize(9).text('Gross Earnings', margin + summaryPadX, summaryBoxTop + 6);
      doc
        .fillColor(inkBlack)
        .font('NotoSans-Bold')
        .fontSize(9.5)
        .text(formatPdfCurrency(grossEarningsVal, currency), margin + pageWidth - 190 - summaryPadX, summaryBoxTop + 5.5, {
          width: 190,
          align: 'right',
        });

      const row2Y = summaryBoxTop + summaryRowH;
      doc.fillColor(muted).font('NotoSans').fontSize(9).text('Total Deductions', margin + summaryPadX, row2Y + 6);
      doc
        .fillColor(inkBlack)
        .font('NotoSans-Bold')
        .fontSize(9.5)
        .text(formatPdfCurrency(totalDeductionsVal, currency), margin + pageWidth - 190 - summaryPadX, row2Y + 5.5, {
          width: 190,
          align: 'right',
        });

      // Prominent Net Payable Salary bar (sharp corporate black with thin TalentGrade red left accent)
      const netBarTop = summaryBoxTop + summaryRowH * 2;
      const netBarHeight = 44;

      doc.rect(margin, netBarTop, pageWidth, netBarHeight).fill(inkBlack);
      doc.rect(margin, netBarTop, 4, netBarHeight).fill(brandRed);

      doc
        .fillColor('#FFFFFF')
        .font('NotoSans-Bold')
        .fontSize(10)
        .text('NET PAYABLE SALARY', margin + summaryPadX + 4, netBarTop + 9, {
          characterSpacing: 0.7,
        });
      doc
        .fillColor('#D4D4D8')
        .font('NotoSans')
        .fontSize(8)
        .text(`Payable in ${currencySubtitle} · ${monthText}`, margin + summaryPadX + 4, netBarTop + 24);

      doc
        .fillColor('#FFFFFF')
        .font('NotoSans-Bold')
        .fontSize(17.5)
        .text(
          formatPdfCurrency(netSalaryVal, currency),
          margin + pageWidth - 230 - summaryPadX,
          netBarTop + 11,
          { width: 230, align: 'right' }
        );

      y = netBarTop + netBarHeight + 14;

      // Optional Payroll Notes (only if configured on the payslip)
      const cleanNotes = payslip.notes ? String(payslip.notes).trim() : '';
      if (cleanNotes) {
        doc
          .fillColor(charcoal)
          .font('NotoSans-Bold')
          .fontSize(8.2)
          .text('REMARKS / PAYROLL NOTES', margin, y, { characterSpacing: 0.8 });
        y += 12;
        const notesH = doc.font('NotoSans').fontSize(8.5).heightOfString(cleanNotes, {
          width: pageWidth,
          lineGap: 2,
        });
        doc
          .fillColor(muted)
          .font('NotoSans')
          .fontSize(8.5)
          .text(cleanNotes, margin, y, { width: pageWidth, lineGap: 2 });
        y += notesH + 10;
      }

      // =========================================================================
      // 5. CORPORATE FOOTER
      // =========================================================================
      const minFooterY = doc.page.height - 56;
      if (y > minFooterY - 6) {
        doc.addPage();
      }
      const footerY = minFooterY;

      doc.moveTo(margin, footerY).lineTo(margin + pageWidth, footerY).strokeColor(ruleMid).lineWidth(0.6).stroke();

      const generatedDate = new Date().toISOString().slice(0, 10);
      const footerLeftWidth = 195;
      const footerRightWidth = pageWidth - footerLeftWidth - 8;

      doc
        .fillColor(lightMuted)
        .font('NotoSans')
        .fontSize(7.5)
        .text(`${companyName} · Confidential Payroll Statement`, margin, footerY + 9, {
          width: footerLeftWidth,
          height: 11,
          ellipsis: true,
        });

      doc.text(
        `Employee: ${payslip.employeeName}${payslip.employeeCode ? ` (${payslip.employeeCode})` : ''} · Generated: ${generatedDate}`,
        margin + footerLeftWidth + 8,
        footerY + 9,
        {
          width: footerRightWidth,
          height: 11,
          align: 'right',
          ellipsis: true,
        }
      );

      doc
        .fillColor('#A1A1AA')
        .font('NotoSans')
        .fontSize(7)
        .text(
          'This is a system-generated payslip and is valid without a physical signature.',
          margin,
          footerY + 23,
          { width: pageWidth, height: 10, align: 'center', ellipsis: true }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
