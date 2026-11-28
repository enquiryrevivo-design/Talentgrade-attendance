import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CreditCard,
  Download,
  Edit3,
  Eye,
  FileText,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { CompanyBadge } from '../components/CompanyBadge';
import {
  AttachmentUploadField,
  MediaPreviewModal,
  UploadedAttachmentInfo,
} from '../components/ReceiptCaptureModal';
import {
  CompanyId,
  Employee,
  EXPENSE_CATEGORIES,
  ExpenseCategory,
  ExpenseClaim,
  ExpenseStatus,
  getAllowedCurrenciesForCompany,
  getCompanyShortName,
  normalizeCompanyId,
  SupportedCurrency,
} from '../types/hr';
import {
  exportToCsv,
  fetchAllEmployees,
  formatMoney,
  getEffectiveSchedule,
  getTodayInTimezone,
} from '../lib/hrService';
import {
  deletePendingExpenseClaim,
  fetchExpenses,
  markExpensePaid,
  reviewExpenseClaim,
  submitExpenseClaim,
  updatePendingExpenseClaim,
} from '../lib/expenseService';

const STATUS_BADGE: Record<ExpenseStatus, string> = {
  Pending: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  Approved: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
  Rejected: 'bg-red-50 text-[#B5121B] border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
  Paid: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
};

function groupAmountsByCurrency(items: ExpenseClaim[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const cur = item.currency || 'INR';
    acc[cur] = (acc[cur] || 0) + item.amount;
    return acc;
  }, {});
}

function CurrencyAmountStack({ totals, emptyCurrency = 'INR' }: { totals: Record<string, number>; emptyCurrency?: string }) {
  const entries = Object.entries(totals);
  if (entries.length === 0) {
    return <span className="font-mono tabular-nums">{formatMoney(0, emptyCurrency)}</span>;
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono tabular-nums">
      {entries.map(([cur, val]) => (
        <span key={cur}>{formatMoney(val, cur)}</span>
      ))}
    </div>
  );
}

export function ExpensesView() {
  const { employee, settings } = useAuth();
  const { showToast } = useToast();

  const todayLocal = getTodayInTimezone(
    employee && settings ? getEffectiveSchedule(employee, settings).timezone : 'Asia/Kolkata'
  );

  const isSuperAdmin = employee?.role === 'super_admin';
  const canApproveExpenses = Boolean(
    isSuperAdmin || (employee?.role === 'team_leader' && settings?.teamLeaderPermissions?.canApproveExpenses)
  );
  const isLeaderViewer = employee?.role === 'team_leader' || isSuperAdmin;

  const [tab, setTab] = useState<'my' | 'approvals'>(() => (isSuperAdmin ? 'approvals' : 'my'));
  const [expenses, setExpenses] = useState<ExpenseClaim[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState<'all' | CompanyId>('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ExpenseCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ExpenseStatus>('all');
  const [monthFilter, setMonthFilter] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');

  // Submit / Edit Claim Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingClaim, setEditingClaim] = useState<ExpenseClaim | null>(null);
  const [savingClaim, setSavingClaim] = useState(false);

  const myCompanyId = normalizeCompanyId(employee?.companyId);
  const allowedCurrencies = getAllowedCurrenciesForCompany(myCompanyId);

  const [formState, setFormState] = useState({
    category: 'Travel' as ExpenseCategory,
    amount: '',
    currency: (allowedCurrencies[0] || 'INR') as SupportedCurrency,
    expenseDate: todayLocal,
    description: '',
    notes: '',
  });
  const [receiptInfo, setReceiptInfo] = useState<UploadedAttachmentInfo | null>(null);

  // Receipt preview
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('Receipt Preview');

  // Review / Payout Modals
  const [reviewModal, setReviewModal] = useState<{
    claim: ExpenseClaim;
    decision: 'Approved' | 'Rejected';
  } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const [payoutModal, setPayoutModal] = useState<ExpenseClaim | null>(null);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [markingPaid, setMarkingPaid] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ExpenseClaim | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    if (!employee || !settings) return;
    setLoading(true);
    try {
      const canViewAll = settings.teamLeaderPermissions?.canViewAllEmployees ?? true;
      const [expList, empList] = await Promise.all([
        fetchExpenses(employee, canApproveExpenses),
        isLeaderViewer ? fetchAllEmployees(employee, canViewAll) : Promise.resolve([]),
      ]);
      setExpenses(expList);
      setEmployees(empList);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load expenses', 'error');
    } finally {
      setLoading(false);
    }
  }, [employee, settings, canApproveExpenses, isLeaderViewer, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (isSuperAdmin) {
      setTab('approvals');
    }
  }, [isSuperAdmin]);

  const myExpenses = useMemo(
    () => (employee ? expenses.filter((e) => e.employeeUid === employee.uid) : []),
    [expenses, employee]
  );

  const scopedExpenses = useMemo(() => {
    const base = tab === 'my' ? myExpenses : expenses;
    return base.filter((e) => {
      if (tab === 'approvals' && companyFilter !== 'all' && e.companyId !== companyFilter) return false;
      if (tab === 'approvals' && employeeFilter !== 'all' && e.employeeId !== employeeFilter) return false;
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (monthFilter && !e.expenseDate.startsWith(monthFilter)) return false;
      if (startDateFilter && e.expenseDate < startDateFilter) return false;
      if (endDateFilter && e.expenseDate > endDateFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          e.employeeName.toLowerCase().includes(q) ||
          e.employeeCode.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          (e.notes || '').toLowerCase().includes(q) ||
          (e.paymentReference || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [
    tab,
    myExpenses,
    expenses,
    companyFilter,
    employeeFilter,
    categoryFilter,
    statusFilter,
    monthFilter,
    startDateFilter,
    endDateFilter,
    search,
  ]);

  if (!employee || !settings) return null;

  const currentMonthStr = todayLocal.slice(0, 7);
  const summarySource = tab === 'my' ? myExpenses : scopedExpenses;

  const pendingItems = summarySource.filter((e) => e.status === 'Pending');
  const approvedItems = summarySource.filter((e) => e.status === 'Approved');
  const paidItems = summarySource.filter((e) => e.status === 'Paid');
  const rejectedItems = summarySource.filter((e) => e.status === 'Rejected');
  const monthlyItems = summarySource.filter((e) =>
    (monthFilter ? e.expenseDate.startsWith(monthFilter) : e.expenseDate.startsWith(currentMonthStr)) &&
    e.status !== 'Rejected'
  );

  const talentGradeItems = scopedExpenses.filter((e) => e.companyId === 'talentgrade' && e.status !== 'Rejected');
  const myGradeItems = scopedExpenses.filter((e) => e.companyId === 'mygrade' && e.status !== 'Rejected');

  const openNewClaimModal = () => {
    setEditingClaim(null);
    setFormState({
      category: 'Travel',
      amount: '',
      currency: myCompanyId === 'mygrade' ? 'INR' : ((employee.currency === 'AED' ? 'AED' : 'INR') as SupportedCurrency),
      expenseDate: todayLocal,
      description: '',
      notes: '',
    });
    setReceiptInfo(null);
    setFormOpen(true);
  };

  const openEditClaimModal = (claim: ExpenseClaim) => {
    setEditingClaim(claim);
    setFormState({
      category: claim.category,
      amount: String(claim.amount),
      currency: claim.companyId === 'mygrade' ? 'INR' : claim.currency,
      expenseDate: claim.expenseDate,
      description: claim.description,
      notes: claim.notes || '',
    });
    setReceiptInfo({
      assetId: claim.receiptAssetId,
      fileName: claim.receiptFileName || 'Attached Receipt',
      mimeType: claim.receiptMimeType || 'image/jpeg',
    });
    setFormOpen(true);
  };

  const handleSubmitClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiptInfo?.assetId) {
      showToast('Please attach a receipt image or PDF before submitting.', 'error');
      return;
    }
    const parsedAmount = Number(formState.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      showToast('Enter a valid expense amount greater than 0.', 'error');
      return;
    }

    setSavingClaim(true);
    try {
      const targetCompany = editingClaim ? editingClaim.companyId : myCompanyId;
      const safeCurrency: SupportedCurrency = targetCompany === 'mygrade' ? 'INR' : formState.currency;

      if (editingClaim) {
        await updatePendingExpenseClaim({
          claimId: editingClaim.id,
          actor: employee,
          category: formState.category,
          amount: parsedAmount,
          currency: safeCurrency,
          expenseDate: formState.expenseDate,
          description: formState.description,
          notes: formState.notes,
          receiptAssetId: receiptInfo.assetId,
          receiptFileName: receiptInfo.fileName,
          receiptMimeType: receiptInfo.mimeType,
        });
        showToast('Pending expense claim updated.', 'success');
      } else {
        await submitExpenseClaim({
          employee,
          category: formState.category,
          amount: parsedAmount,
          currency: safeCurrency,
          expenseDate: formState.expenseDate,
          description: formState.description,
          notes: formState.notes,
          receiptAssetId: receiptInfo.assetId,
          receiptFileName: receiptInfo.fileName,
          receiptMimeType: receiptInfo.mimeType,
        });
        showToast('Expense reimbursement claim submitted.', 'success');
      }
      setFormOpen(false);
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not save expense claim', 'error');
    } finally {
      setSavingClaim(false);
    }
  };

  const handleConfirmReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewModal) return;
    setReviewing(true);
    try {
      await reviewExpenseClaim({
        claimId: reviewModal.claim.id,
        decision: reviewModal.decision,
        actor: employee,
        canApproveExpenses,
        note: reviewNote,
      });
      showToast(`Expense claim ${reviewModal.decision.toLowerCase()}.`, 'success');
      setReviewModal(null);
      setReviewNote('');
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Review failed', 'error');
    } finally {
      setReviewing(false);
    }
  };

  const handleConfirmPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutModal) return;
    setMarkingPaid(true);
    try {
      await markExpensePaid({
        claimId: payoutModal.id,
        actor: employee,
        canApproveExpenses,
        paymentReference,
        paymentNote,
      });
      showToast('Expense claim marked as Paid.', 'success');
      setPayoutModal(null);
      setPaymentReference('');
      setPaymentNote('');
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Payout update failed', 'error');
    } finally {
      setMarkingPaid(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deletePendingExpenseClaim(deleteTarget, employee);
      showToast('Expense claim deleted.', 'info');
      setDeleteTarget(null);
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleExportCsv = () => {
    exportToCsv(
      `expense_claims_${tab}_${todayLocal}.csv`,
      [
        'Claim ID',
        'Employee Code',
        'Employee Name',
        'Company',
        'Department',
        'Expense Date',
        'Category',
        'Amount',
        'Currency',
        'Status',
        'Description',
        'Notes',
        'Reviewed By',
        'Rejection / Approval Note',
        'Paid By',
        'Payment Reference',
      ],
      scopedExpenses.map((c) => [
        c.id,
        c.employeeCode,
        c.employeeName,
        getCompanyShortName(c.companyId),
        c.department,
        c.expenseDate,
        c.category,
        c.amount,
        c.currency,
        c.status,
        c.description,
        c.notes || '',
        c.reviewedByName || '',
        c.rejectionReason || c.approvalNote || '',
        c.paidByName || '',
        c.paymentReference || '',
      ])
    );
    showToast('Expense CSV exported.', 'success');
  };

  const canActOnClaim = (c: ExpenseClaim) =>
    isSuperAdmin ||
    (canApproveExpenses &&
      c.companyId === myCompanyId &&
      c.employeeUid !== employee.uid);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-zinc-950 dark:text-zinc-100">
            Expense Reimbursement Portal
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Submit claims with receipts, track approvals &amp; payouts ·{' '}
            {myCompanyId === 'mygrade' ? 'MyGrade (INR only)' : 'TalentGrade (INR / AED) · MyGrade (INR)'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportCsv}
            className="min-h-[42px] px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium inline-flex items-center gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={openNewClaimModal}
            className="min-h-[42px] px-5 py-2 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Submit Expense
          </button>
        </div>
      </div>

      {/* View Tabs */}
      {isLeaderViewer && (
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-zinc-200/70 dark:bg-zinc-800 text-xs">
          <button
            type="button"
            onClick={() => setTab('my')}
            className={`px-4 py-2 rounded-lg font-medium ${
              tab === 'my'
                ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            My Claims ({myExpenses.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('approvals')}
            className={`px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2 ${
              tab === 'approvals'
                ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            {isSuperAdmin ? 'All Company Claims' : 'Company Approvals'} ({expenses.length})
            {expenses.filter((c) => c.status === 'Pending' && canActOnClaim(c)).length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-[#B5121B] text-white text-[10px] font-mono">
                {expenses.filter((c) => c.status === 'Pending' && canActOnClaim(c)).length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Multi-Currency KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {tab === 'my' ? 'Total Submitted' : 'Total Claims'}
          </div>
          <div className="text-lg font-bold font-mono tabular-nums mt-1">{summarySource.length}</div>
          <div className="text-[11px] text-zinc-500 mt-1">
            <CurrencyAmountStack
              totals={groupAmountsByCurrency(summarySource.filter((e) => e.status !== 'Rejected'))}
              emptyCurrency={myCompanyId === 'mygrade' ? 'INR' : 'INR'}
            />
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Pending</div>
          <div className="text-lg font-bold font-mono tabular-nums mt-1 text-amber-600 dark:text-amber-400">
            {pendingItems.length}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            <CurrencyAmountStack totals={groupAmountsByCurrency(pendingItems)} />
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Approved (Unpaid)</div>
          <div className="text-lg font-bold font-mono tabular-nums mt-1 text-sky-600 dark:text-sky-400">
            {approvedItems.length}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            <CurrencyAmountStack totals={groupAmountsByCurrency(approvedItems)} />
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Paid Reimbursements</div>
          <div className="text-lg font-bold font-mono tabular-nums mt-1 text-emerald-600 dark:text-emerald-400">
            {paidItems.length}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            <CurrencyAmountStack totals={groupAmountsByCurrency(paidItems)} />
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Rejected</div>
          <div className="text-lg font-bold font-mono tabular-nums mt-1 text-[#B5121B] dark:text-red-400">
            {rejectedItems.length}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            <CurrencyAmountStack totals={groupAmountsByCurrency(rejectedItems)} />
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Monthly ({monthFilter || currentMonthStr})
          </div>
          <div className="text-lg font-bold font-mono tabular-nums mt-1">{monthlyItems.length}</div>
          <div className="text-[11px] text-zinc-500 mt-1">
            <CurrencyAmountStack totals={groupAmountsByCurrency(monthlyItems)} />
          </div>
        </div>
      </div>

      {/* Company-wise Breakdown (for Admins) */}
      {tab === 'approvals' && isSuperAdmin && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 flex items-center justify-between gap-3">
            <div>
              <CompanyBadge companyId="talentgrade" />
              <div className="text-[11px] text-zinc-500 mt-1.5">
                {talentGradeItems.length} active claim(s) · INR &amp; AED kept separate
              </div>
            </div>
            <div className="text-right text-sm font-bold text-zinc-950 dark:text-zinc-100">
              <CurrencyAmountStack totals={groupAmountsByCurrency(talentGradeItems)} />
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 flex items-center justify-between gap-3">
            <div>
              <CompanyBadge companyId="mygrade" />
              <div className="text-[11px] text-zinc-500 mt-1.5">
                {myGradeItems.length} active claim(s) · Strictly INR
              </div>
            </div>
            <div className="text-right text-sm font-bold text-zinc-950 dark:text-zinc-100">
              <CurrencyAmountStack totals={groupAmountsByCurrency(myGradeItems)} />
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 text-xs">
        <div className="relative lg:col-span-2">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search description, employee, reference..."
            className="w-full min-h-[38px] pl-9 pr-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
          />
        </div>

        {tab === 'approvals' && isSuperAdmin && (
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value as 'all' | CompanyId)}
            className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-medium"
          >
            <option value="all">All Companies</option>
            <option value="talentgrade">TalentGrade</option>
            <option value="mygrade">MyGrade</option>
          </select>
        )}

        {tab === 'approvals' && (
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
          >
            <option value="all">All Employees</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName} ({emp.employeeCode})
              </option>
            ))}
          </select>
        )}

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as 'all' | ExpenseCategory)}
          className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
        >
          <option value="all">All Categories</option>
          {EXPENSE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | ExpenseStatus)}
          className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
        >
          <option value="all">All Statuses</option>
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Paid">Paid</option>
          <option value="Rejected">Rejected</option>
        </select>

        <input
          type="month"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          aria-label="Filter by month"
          className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
        />

        <div className="flex items-center gap-2 lg:col-span-2">
          <input
            type="date"
            value={startDateFilter}
            onChange={(e) => setStartDateFilter(e.target.value)}
            aria-label="Start date"
            className="flex-1 min-h-[38px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
          />
          <span className="text-zinc-400">→</span>
          <input
            type="date"
            value={endDateFilter}
            onChange={(e) => setEndDateFilter(e.target.value)}
            aria-label="End date"
            className="flex-1 min-h-[38px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
          />
          {(monthFilter || startDateFilter || endDateFilter || categoryFilter !== 'all' || statusFilter !== 'all' || companyFilter !== 'all' || employeeFilter !== 'all' || search) && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setCompanyFilter('all');
                setEmployeeFilter('all');
                setCategoryFilter('all');
                setStatusFilter('all');
                setMonthFilter('');
                setStartDateFilter('');
                setEndDateFilter('');
              }}
              className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 whitespace-nowrap"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Claims Table */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            <div className="h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
            <div className="h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          </div>
        ) : scopedExpenses.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <CreditCard className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto" />
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No expense claims found</p>
            <p className="text-xs text-zinc-500">
              {tab === 'my'
                ? 'Click "Submit Expense" to file a new reimbursement claim with a receipt.'
                : 'Adjust filters or wait for employees to submit claims.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                  <th className="py-3 px-4 font-medium">Date</th>
                  {tab === 'approvals' && <th className="py-3 px-4 font-medium">Employee</th>}
                  <th className="py-3 px-4 font-medium">Company</th>
                  <th className="py-3 px-4 font-medium">Category &amp; Description</th>
                  <th className="py-3 px-4 font-medium text-right">Amount</th>
                  <th className="py-3 px-4 font-medium">Receipt</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {scopedExpenses.map((c) => {
                  const isOwner = c.employeeUid === employee.uid;
                  const canEditDelete = isOwner && c.status === 'Pending';
                  const canReview = c.status === 'Pending' && canActOnClaim(c);
                  const canPay = c.status === 'Approved' && canActOnClaim(c);

                  return (
                    <tr key={c.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 align-top">
                      <td className="py-3 px-4 font-mono whitespace-nowrap">{c.expenseDate}</td>
                      {tab === 'approvals' && (
                        <td className="py-3 px-4">
                          <div className="font-semibold text-zinc-950 dark:text-zinc-100">{c.employeeName}</div>
                          <div className="text-[11px] text-zinc-500 font-mono">
                            {c.employeeCode} · {c.department}
                          </div>
                        </td>
                      )}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <CompanyBadge companyId={c.companyId} />
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <div className="font-semibold text-zinc-950 dark:text-zinc-100">{c.category}</div>
                        <div className="text-zinc-700 dark:text-zinc-300 mt-0.5">{c.description}</div>
                        {c.notes && (
                          <div className="text-[11px] text-zinc-500 mt-0.5">Note: {c.notes}</div>
                        )}
                        {c.status === 'Rejected' && c.rejectionReason && (
                          <div className="text-[11px] text-[#B5121B] dark:text-red-400 mt-1 font-medium">
                            Rejection reason: {c.rejectionReason}
                          </div>
                        )}
                        {c.status === 'Approved' && c.approvalNote && (
                          <div className="text-[11px] text-sky-700 dark:text-sky-400 mt-1">
                            Approval note: {c.approvalNote}
                          </div>
                        )}
                        {c.status === 'Paid' && (
                          <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1 font-mono">
                            Paid by {c.paidByName || 'Admin'}
                            {c.paymentReference ? ` · Ref: ${c.paymentReference}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold whitespace-nowrap">
                        {formatMoney(c.amount, c.currency)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setPreviewTitle(`Receipt · ${c.employeeName} (${c.expenseDate})`);
                            setPreviewAssetId(c.receiptAssetId);
                          }}
                          className="min-h-[32px] px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 inline-flex items-center gap-1.5 text-[11px] font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          {c.receiptMimeType === 'application/pdf' ? (
                            <FileText className="w-3.5 h-3.5 text-[#B5121B]" />
                          ) : (
                            <Eye className="w-3.5 h-3.5 text-[#B5121B]" />
                          )}
                          View Receipt
                        </button>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${STATUS_BADGE[c.status]}`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {canEditDelete && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditClaimModal(c)}
                                title="Edit pending claim"
                                className="min-h-[32px] px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(c)}
                                title="Delete pending claim"
                                className="min-h-[32px] px-2.5 py-1 rounded-lg border border-red-200 dark:border-red-900/60 text-[#B5121B] dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          {canReview && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setReviewNote('');
                                  setReviewModal({ claim: c, decision: 'Approved' });
                                }}
                                className="min-h-[32px] px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-1"
                              >
                                <Check className="w-3.5 h-3.5" />
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setReviewNote('');
                                  setReviewModal({ claim: c, decision: 'Rejected' });
                                }}
                                className="min-h-[32px] px-2.5 py-1 rounded-lg border border-red-200 dark:border-red-900 text-[#B5121B] dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 font-semibold"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {canPay && (
                            <button
                              type="button"
                              onClick={() => {
                                setPaymentReference('');
                                setPaymentNote('');
                                setPayoutModal(c);
                              }}
                              className="min-h-[32px] px-3 py-1 rounded-lg bg-black dark:bg-white text-white dark:text-black font-semibold inline-flex items-center gap-1"
                            >
                              Mark Paid
                            </button>
                          )}
                          {!canEditDelete && isSuperAdmin && c.status !== 'Pending' && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(c)}
                              title="Delete expense claim (Super Admin)"
                              className="min-h-[32px] px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-[#B5121B]"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Submit / Edit Expense Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitClaim}
            className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl max-h-[92vh] flex flex-col"
          >
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">
                  {editingClaim ? 'Edit Pending Expense Claim' : 'Submit Expense Claim'}
                </h3>
                <div className="mt-1">
                  <CompanyBadge companyId={editingClaim ? editingClaim.companyId : myCompanyId} />
                </div>
              </div>
              <button type="button" onClick={() => setFormOpen(false)} className="text-zinc-500 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto text-xs">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Expense Category *</label>
                  <select
                    required
                    value={formState.category}
                    onChange={(e) => setFormState({ ...formState, category: e.target.value as ExpenseCategory })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  >
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium mb-1">Expense Date *</label>
                  <input
                    type="date"
                    required
                    max={todayLocal}
                    value={formState.expenseDate}
                    onChange={(e) => setFormState({ ...formState, expenseDate: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Amount *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="10000000"
                    required
                    value={formState.amount}
                    onChange={(e) => setFormState({ ...formState, amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-medium mb-1">Currency *</label>
                  <select
                    disabled={(editingClaim ? editingClaim.companyId : myCompanyId) === 'mygrade'}
                    value={(editingClaim ? editingClaim.companyId : myCompanyId) === 'mygrade' ? 'INR' : formState.currency}
                    onChange={(e) => setFormState({ ...formState, currency: e.target.value as SupportedCurrency })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono disabled:opacity-75"
                  >
                    <option value="INR">INR (₹)</option>
                    {(editingClaim ? editingClaim.companyId : myCompanyId) !== 'mygrade' && (
                      <option value="AED">AED (د.إ)</option>
                    )}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium mb-1">Description / Business Purpose *</label>
                <input
                  required
                  minLength={3}
                  maxLength={500}
                  value={formState.description}
                  onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                  placeholder="e.g. Client visit cab fare from Koramangala to Whitefield"
                  className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                />
              </div>

              <div>
                <label className="block font-medium mb-1">Optional Notes</label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={formState.notes}
                  onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
                  placeholder="Invoice number, attendees, or additional context..."
                  className="w-full py-2 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                />
              </div>

              <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60">
                <AttachmentUploadField
                  ownerUid={employee.uid}
                  assetType="expense_receipt"
                  allowPdf
                  label="Receipt Attachment (Required) *"
                  value={receiptInfo}
                  onChange={setReceiptInfo}
                  onError={(msg) => showToast(msg, 'error')}
                />
              </div>
            </div>

            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex gap-3">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingClaim || !receiptInfo?.assetId}
                className="flex-1 min-h-[44px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold disabled:opacity-50"
              >
                {savingClaim ? 'Saving...' : editingClaim ? 'Update Claim' : 'Submit Claim'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Approve / Reject Modal */}
      {reviewModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmReview}
            className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl"
          >
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="text-base font-semibold">
                {reviewModal.decision === 'Approved' ? 'Approve Expense Claim' : 'Reject Expense Claim'}
              </h3>
              <button type="button" onClick={() => setReviewModal(null)} className="text-zinc-500 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-1">
                <div className="font-semibold">
                  {reviewModal.claim.employeeName} · {formatMoney(reviewModal.claim.amount, reviewModal.claim.currency)}
                </div>
                <div className="text-zinc-500">
                  {reviewModal.claim.category} · {reviewModal.claim.expenseDate}
                </div>
                <div className="text-zinc-700 dark:text-zinc-300">{reviewModal.claim.description}</div>
              </div>

              <div>
                <label className="block font-medium mb-1">
                  {reviewModal.decision === 'Rejected' ? 'Rejection Reason (Required) *' : 'Approval Note (Optional)'}
                </label>
                <textarea
                  rows={3}
                  required={reviewModal.decision === 'Rejected'}
                  minLength={reviewModal.decision === 'Rejected' ? 3 : 0}
                  maxLength={500}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder={
                    reviewModal.decision === 'Rejected'
                      ? 'Explain why this claim is rejected...'
                      : 'Optional note for finance / employee...'
                  }
                  className="w-full py-2 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                />
              </div>
            </div>
            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex gap-3">
              <button
                type="button"
                onClick={() => setReviewModal(null)}
                className="flex-1 min-h-[42px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={reviewing || (reviewModal.decision === 'Rejected' && reviewNote.trim().length < 3)}
                className={`flex-1 min-h-[42px] rounded-xl text-white text-xs font-semibold disabled:opacity-50 ${
                  reviewModal.decision === 'Approved'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-[#B5121B] hover:bg-[#960E16]'
                }`}
              >
                {reviewing
                  ? 'Saving...'
                  : reviewModal.decision === 'Approved'
                  ? 'Confirm Approval'
                  : 'Confirm Rejection'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Mark Paid Modal */}
      {payoutModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmPaid}
            className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl"
          >
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="text-base font-semibold">Mark Reimbursement Paid</h3>
              <button type="button" onClick={() => setPayoutModal(null)} className="text-zinc-500 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                <div className="font-semibold">
                  {payoutModal.employeeName} · {formatMoney(payoutModal.amount, payoutModal.currency)}
                </div>
                <div className="text-zinc-500 mt-0.5">{payoutModal.description}</div>
              </div>
              <div>
                <label className="block font-medium mb-1">Payment Reference / UTR (Optional)</label>
                <input
                  maxLength={120}
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="e.g. NEFT-99881122 or Payroll Run"
                  className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Payment Note (Optional)</label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  placeholder="Settlement mode or remarks..."
                  className="w-full py-2 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                />
              </div>
            </div>
            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex gap-3">
              <button
                type="button"
                onClick={() => setPayoutModal(null)}
                className="flex-1 min-h-[42px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={markingPaid}
                className="flex-1 min-h-[42px] rounded-xl bg-black dark:bg-white text-white dark:text-black text-xs font-semibold disabled:opacity-50"
              >
                {markingPaid ? 'Updating...' : 'Confirm Paid'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 shadow-2xl text-xs">
            <h3 className="text-base font-semibold">Delete Expense Claim?</h3>
            <p className="text-zinc-600 dark:text-zinc-300">
              Delete claim for{' '}
              <span className="font-semibold">
                {formatMoney(deleteTarget.amount, deleteTarget.currency)} ({deleteTarget.category})
              </span>
              ? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 min-h-[40px] rounded-xl border border-zinc-200 dark:border-zinc-700 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="flex-1 min-h-[40px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <MediaPreviewModal
        assetId={previewAssetId}
        title={previewTitle}
        onClose={() => setPreviewAssetId(null)}
      />
    </div>
  );
}
