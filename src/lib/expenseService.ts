import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import {
  assertCurrencyAllowedForCompany,
  CompanyId,
  Employee,
  EXPENSE_CATEGORIES,
  ExpenseCategory,
  ExpenseClaim,
  normalizeCompanyId,
  SupportedCurrency,
} from '../types/hr';
import { cleanObject, deleteMediaAsset, makeSafeId, writeAuditLog } from './hrService';

function timestampToMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'string') {
    const ms = new Date(ts).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof ts === 'object' && ts !== null) {
    const maybe = ts as { toMillis?: () => number; seconds?: number };
    if (typeof maybe.toMillis === 'function') return maybe.toMillis();
    if (typeof maybe.seconds === 'number') return maybe.seconds * 1000;
  }
  return 0;
}

function isValidIsoDate(val: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(val.trim());
}

export async function fetchExpenses(
  actor: Employee,
  canApproveExpenses: boolean
): Promise<ExpenseClaim[]> {
  try {
    const actorCompanyId = normalizeCompanyId(actor.companyId);

    if (actor.role === 'super_admin') {
      const snap = await getDocs(
        query(collection(db, 'expenses'), orderBy('createdAt', 'desc'), limit(500))
      );
      return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ExpenseClaim, 'id'>),
      }));
    }

    if (actor.role === 'team_leader' && canApproveExpenses) {
      const snap = await getDocs(
        query(collection(db, 'expenses'), where('companyId', '==', actorCompanyId))
      );
      return snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ExpenseClaim, 'id'>) }))
        .sort((a, b) => {
          const diff = timestampToMs(b.createdAt) - timestampToMs(a.createdAt);
          return diff !== 0 ? diff : b.expenseDate.localeCompare(a.expenseDate);
        });
    }

    if (actor.role === 'team_leader') {
      const [ownSnap, teamSnap] = await Promise.all([
        getDocs(query(collection(db, 'expenses'), where('employeeUid', '==', actor.uid))),
        getDocs(
          query(
            collection(db, 'expenses'),
            where('companyId', '==', actorCompanyId),
            where('managerUid', '==', actor.uid)
          )
        ),
      ]);
      const map = new Map<string, ExpenseClaim>();
      for (const d of [...ownSnap.docs, ...teamSnap.docs]) {
        map.set(d.id, { id: d.id, ...(d.data() as Omit<ExpenseClaim, 'id'>) });
      }
      return Array.from(map.values()).sort((a, b) => {
        const diff = timestampToMs(b.createdAt) - timestampToMs(a.createdAt);
        return diff !== 0 ? diff : b.expenseDate.localeCompare(a.expenseDate);
      });
    }

    const snap = await getDocs(
      query(collection(db, 'expenses'), where('employeeUid', '==', actor.uid))
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<ExpenseClaim, 'id'>) }))
      .sort((a, b) => {
        const diff = timestampToMs(b.createdAt) - timestampToMs(a.createdAt);
        return diff !== 0 ? diff : b.expenseDate.localeCompare(a.expenseDate);
      });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'expenses');
  }
}

export async function submitExpenseClaim(params: {
  employee: Employee;
  category: ExpenseCategory;
  amount: number;
  currency: SupportedCurrency;
  expenseDate: string;
  description: string;
  notes?: string;
  receiptAssetId: string;
  receiptFileName?: string;
  receiptMimeType?: string;
}): Promise<ExpenseClaim> {
  if (!EXPENSE_CATEGORIES.includes(params.category)) {
    throw new Error('Invalid expense category selected.');
  }
  const companyId: CompanyId = normalizeCompanyId(params.employee.companyId);
  const currency = assertCurrencyAllowedForCompany(companyId, params.currency);

  const amount = Math.round(Number(params.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
    throw new Error('Expense amount must be greater than 0 and within valid limits.');
  }
  if (!isValidIsoDate(params.expenseDate)) {
    throw new Error('Expense date must be in YYYY-MM-DD format.');
  }
  const description = params.description.trim();
  if (description.length < 3 || description.length > 500) {
    throw new Error('Description / purpose must be between 3 and 500 characters.');
  }
  if (!params.receiptAssetId || !params.receiptAssetId.trim()) {
    throw new Error('A receipt image or PDF attachment is required.');
  }

  const callerUid = auth.currentUser?.uid || params.employee.uid;
  const id = makeSafeId('exp');
  const notes = params.notes?.trim() ? params.notes.trim().slice(0, 500) : undefined;

  const payload = cleanObject({
    employeeId: params.employee.id,
    employeeUid: callerUid,
    employeeCode: (params.employee.employeeCode || 'EMP').slice(0, 40),
    employeeName: params.employee.fullName.slice(0, 120),
    department: (params.employee.department || 'General').slice(0, 80),
    managerUid: params.employee.managerUid || undefined,
    companyId,
    category: params.category,
    amount,
    currency,
    expenseDate: params.expenseDate.trim(),
    description,
    notes,
    receiptAssetId: params.receiptAssetId.trim().slice(0, 128),
    receiptFileName: params.receiptFileName?.trim().slice(0, 160) || undefined,
    receiptMimeType: params.receiptMimeType?.trim().slice(0, 80) || undefined,
    status: 'Pending' as const,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(doc(db, 'expenses', id), payload);
    await writeAuditLog({
      actor: params.employee,
      action: 'EXPENSE_SUBMITTED',
      entityType: 'ExpenseClaim',
      entityId: id,
      updatedValues: {
        companyId,
        category: params.category,
        amount,
        currency,
        expenseDate: params.expenseDate,
      },
      summary: `${params.employee.fullName} submitted ${params.category} expense claim (${currency} ${amount.toFixed(2)}) for ${params.expenseDate}.`,
    });
    return {
      id,
      ...(payload as unknown as Omit<ExpenseClaim, 'id'>),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `expenses/${id}`);
  }
}

export async function updatePendingExpenseClaim(params: {
  claimId: string;
  actor: Employee;
  category: ExpenseCategory;
  amount: number;
  currency: SupportedCurrency;
  expenseDate: string;
  description: string;
  notes?: string;
  receiptAssetId: string;
  receiptFileName?: string;
  receiptMimeType?: string;
}): Promise<void> {
  if (!EXPENSE_CATEGORIES.includes(params.category)) {
    throw new Error('Invalid expense category selected.');
  }
  const amount = Math.round(Number(params.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
    throw new Error('Expense amount must be greater than 0.');
  }
  if (!isValidIsoDate(params.expenseDate)) {
    throw new Error('Expense date must be in YYYY-MM-DD format.');
  }
  const description = params.description.trim();
  if (description.length < 3 || description.length > 500) {
    throw new Error('Description / purpose must be between 3 and 500 characters.');
  }
  if (!params.receiptAssetId || !params.receiptAssetId.trim()) {
    throw new Error('A receipt image or PDF attachment is required.');
  }

  const callerUid = auth.currentUser?.uid || params.actor.uid;
  const ref = doc(db, 'expenses', params.claimId);
  let previousReceiptId: string | undefined;
  let previousValues: Record<string, unknown> = {};

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new Error('Expense claim not found.');
      }
      const existing = snap.data() as ExpenseClaim;
      if (existing.employeeUid !== callerUid) {
        throw new Error('You can only edit your own expense claims.');
      }
      if (existing.status !== 'Pending') {
        throw new Error('Approved, rejected, or paid expense claims cannot be edited.');
      }

      const safeCurrency = assertCurrencyAllowedForCompany(existing.companyId, params.currency);
      previousValues = {
        category: existing.category,
        amount: existing.amount,
        currency: existing.currency,
        expenseDate: existing.expenseDate,
      };
      if (existing.receiptAssetId !== params.receiptAssetId.trim()) {
        previousReceiptId = existing.receiptAssetId;
      }

      tx.update(
        ref,
        cleanObject({
          category: params.category,
          amount,
          currency: safeCurrency,
          expenseDate: params.expenseDate.trim(),
          description,
          notes: params.notes?.trim() ? params.notes.trim().slice(0, 500) : '',
          receiptAssetId: params.receiptAssetId.trim().slice(0, 128),
          receiptFileName: params.receiptFileName?.trim().slice(0, 160) || existing.receiptFileName || '',
          receiptMimeType: params.receiptMimeType?.trim().slice(0, 80) || existing.receiptMimeType || '',
          updatedAt: serverTimestamp(),
        })
      );
    });

    if (previousReceiptId) {
      await deleteMediaAsset(previousReceiptId);
    }

    await writeAuditLog({
      actor: params.actor,
      action: 'EXPENSE_UPDATED',
      entityType: 'ExpenseClaim',
      entityId: params.claimId,
      previousValues,
      updatedValues: {
        category: params.category,
        amount,
        currency: params.currency,
        expenseDate: params.expenseDate,
      },
      summary: `${params.actor.fullName} updated pending expense claim ${params.claimId}.`,
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('not found') ||
        err.message.includes('only edit') ||
        err.message.includes('cannot be edited') ||
        err.message.includes('MyGrade'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `expenses/${params.claimId}`);
  }
}

export async function deletePendingExpenseClaim(
  claim: ExpenseClaim,
  actor: Employee
): Promise<void> {
  const callerUid = auth.currentUser?.uid || actor.uid;
  const isSuperAdmin = actor.role === 'super_admin';
  if (!isSuperAdmin && (claim.employeeUid !== callerUid || claim.status !== 'Pending')) {
    throw new Error('Only pending expense claims can be deleted by the submitter.');
  }

  try {
    await deleteDoc(doc(db, 'expenses', claim.id));
    if (claim.receiptAssetId) {
      await deleteMediaAsset(claim.receiptAssetId);
    }
    await writeAuditLog({
      actor,
      action: 'EXPENSE_DELETED',
      entityType: 'ExpenseClaim',
      entityId: claim.id,
      previousValues: {
        employeeName: claim.employeeName,
        category: claim.category,
        amount: claim.amount,
        currency: claim.currency,
        status: claim.status,
      },
      summary: `Deleted expense claim ${claim.id} (${claim.currency} ${claim.amount.toFixed(2)} · ${claim.category}).`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `expenses/${claim.id}`);
  }
}

export async function reviewExpenseClaim(params: {
  claimId: string;
  decision: 'Approved' | 'Rejected';
  actor: Employee;
  canApproveExpenses: boolean;
  note?: string;
}): Promise<void> {
  const isSuperAdmin = params.actor.role === 'super_admin';
  const isAllowedLeader = params.actor.role === 'team_leader' && params.canApproveExpenses;
  if (!isSuperAdmin && !isAllowedLeader) {
    throw new Error('You do not have permission to review expense claims.');
  }

  const trimmedNote = (params.note || '').trim();
  if (params.decision === 'Rejected' && trimmedNote.length < 3) {
    throw new Error('A rejection reason (at least 3 characters) is required.');
  }

  const actorUid = auth.currentUser?.uid || params.actor.uid;
  const actorName = (params.actor.fullName || params.actor.email || 'Admin').trim().slice(0, 120);
  const actorCompanyId = normalizeCompanyId(params.actor.companyId);
  const ref = doc(db, 'expenses', params.claimId);
  const nowIso = new Date().toISOString();

  let claimSnapshot: ExpenseClaim | null = null;

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new Error('Expense claim not found.');
      }
      const existing = { id: snap.id, ...(snap.data() as Omit<ExpenseClaim, 'id'>) };
      claimSnapshot = existing;

      if (!isSuperAdmin) {
        if (existing.companyId !== actorCompanyId) {
          throw new Error('Cross-company expense approvals are restricted to Super Admin.');
        }
        if (existing.employeeUid === actorUid) {
          throw new Error('Team Leaders cannot approve or reject their own expense claims.');
        }
      }
      if (existing.status !== 'Pending') {
        throw new Error(`Expense claim has already been marked as ${existing.status}.`);
      }

      if (params.decision === 'Approved') {
        tx.update(
          ref,
          cleanObject({
            status: 'Approved',
            reviewedByUid: actorUid,
            reviewedByName: actorName,
            reviewedAtIso: nowIso,
            reviewedAt: serverTimestamp(),
            approvalNote: trimmedNote ? trimmedNote.slice(0, 500) : '',
            updatedAt: serverTimestamp(),
          })
        );
      } else {
        tx.update(ref, {
          status: 'Rejected',
          reviewedByUid: actorUid,
          reviewedByName: actorName,
          reviewedAtIso: nowIso,
          reviewedAt: serverTimestamp(),
          rejectionReason: trimmedNote.slice(0, 500),
          updatedAt: serverTimestamp(),
        });
      }
    });

    const c = claimSnapshot as ExpenseClaim | null;
    await writeAuditLog({
      actor: params.actor,
      action: params.decision === 'Approved' ? 'EXPENSE_APPROVED' : 'EXPENSE_REJECTED',
      entityType: 'ExpenseClaim',
      entityId: params.claimId,
      previousValues: { status: 'Pending' },
      updatedValues: {
        status: params.decision,
        note: trimmedNote || undefined,
      },
      summary: `${params.decision} expense claim for ${c?.employeeName || params.claimId} (${c?.currency || ''} ${c ? c.amount.toFixed(2) : ''})${trimmedNote ? ` — ${trimmedNote}` : ''}.`,
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('not found') ||
        err.message.includes('already been marked') ||
        err.message.includes('permission') ||
        err.message.includes('Cross-company') ||
        err.message.includes('own expense') ||
        err.message.includes('rejection reason'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `expenses/${params.claimId}`);
  }
}

export async function markExpensePaid(params: {
  claimId: string;
  actor: Employee;
  canApproveExpenses: boolean;
  paymentReference?: string;
  paymentNote?: string;
}): Promise<void> {
  const isSuperAdmin = params.actor.role === 'super_admin';
  const isAllowedLeader = params.actor.role === 'team_leader' && params.canApproveExpenses;
  if (!isSuperAdmin && !isAllowedLeader) {
    throw new Error('You do not have permission to mark expenses as paid.');
  }

  const actorUid = auth.currentUser?.uid || params.actor.uid;
  const actorName = (params.actor.fullName || params.actor.email || 'Admin').trim().slice(0, 120);
  const actorCompanyId = normalizeCompanyId(params.actor.companyId);
  const ref = doc(db, 'expenses', params.claimId);
  const nowIso = new Date().toISOString();
  const paymentRef = params.paymentReference?.trim().slice(0, 120) || '';
  const paymentNote = params.paymentNote?.trim().slice(0, 500) || '';

  let claimSnapshot: ExpenseClaim | null = null;

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new Error('Expense claim not found.');
      }
      const existing = { id: snap.id, ...(snap.data() as Omit<ExpenseClaim, 'id'>) };
      claimSnapshot = existing;

      if (!isSuperAdmin) {
        if (existing.companyId !== actorCompanyId) {
          throw new Error('Cross-company expense payouts are restricted to Super Admin.');
        }
        if (existing.employeeUid === actorUid) {
          throw new Error('Team Leaders cannot mark their own expense claims as paid.');
        }
      }
      if (existing.status !== 'Approved') {
        throw new Error('Only Approved expense claims can be marked as Paid.');
      }

      tx.update(ref, {
        status: 'Paid',
        paidByUid: actorUid,
        paidByName: actorName,
        paidAtIso: nowIso,
        paidAt: serverTimestamp(),
        paymentReference: paymentRef,
        paymentNote,
        updatedAt: serverTimestamp(),
      });
    });

    const c = claimSnapshot as ExpenseClaim | null;
    await writeAuditLog({
      actor: params.actor,
      action: 'EXPENSE_PAID',
      entityType: 'ExpenseClaim',
      entityId: params.claimId,
      previousValues: { status: 'Approved' },
      updatedValues: {
        status: 'Paid',
        paymentReference: paymentRef || undefined,
      },
      summary: `Marked expense claim paid for ${c?.employeeName || params.claimId} (${c?.currency || ''} ${c ? c.amount.toFixed(2) : ''})${paymentRef ? ` · Ref: ${paymentRef}` : ''}.`,
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('not found') ||
        err.message.includes('Approved') ||
        err.message.includes('permission') ||
        err.message.includes('Cross-company') ||
        err.message.includes('own expense'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `expenses/${params.claimId}`);
  }
}
