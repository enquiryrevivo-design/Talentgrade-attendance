import {
  collection,
  deleteField,
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
  ASSET_CATEGORIES,
  ASSET_CONDITIONS,
  ASSET_STATUSES,
  assertCurrencyAllowedForCompany,
  AssetAssignment,
  AssetCategory,
  AssetCondition,
  AssetStatus,
  CompanyAsset,
  CompanyId,
  Employee,
  normalizeCompanyId,
  SupportedCurrency,
} from '../types/hr';
import { cleanObject, makeSafeId, writeAuditLog } from './hrService';

export const ASSET_ACKNOWLEDGMENT_NOTICE =
  'Digital receipt confirmation recorded by the employee in the portal. This timestamped confirmation verifies custody receipt only and is not represented as a legally binding cryptographic signature.';

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

export interface EmployeeAssetClearanceSummary {
  employeeId: string;
  assignments: AssetAssignment[];
  currentlyAssigned: AssetAssignment[];
  unacknowledged: AssetAssignment[];
  returned: AssetAssignment[];
  clearanceStatus: 'No Assets Assigned' | 'Pending Return' | 'Pending Acknowledgment' | 'Cleared';
}

export function computeEmployeeAssetClearance(
  employeeId: string,
  assignments: AssetAssignment[]
): EmployeeAssetClearanceSummary {
  const empAssignments = assignments.filter((a) => a.employeeId === employeeId);
  const currentlyAssigned = empAssignments.filter((a) => !a.returned);
  const unacknowledged = currentlyAssigned.filter((a) => !a.acknowledged);
  const returned = empAssignments.filter((a) => a.returned);

  let clearanceStatus: EmployeeAssetClearanceSummary['clearanceStatus'] = 'No Assets Assigned';
  if (currentlyAssigned.length > 0) {
    clearanceStatus = 'Pending Return';
  } else if (empAssignments.length > 0) {
    clearanceStatus = 'Cleared';
  }

  return {
    employeeId,
    assignments: empAssignments,
    currentlyAssigned,
    unacknowledged,
    returned,
    clearanceStatus,
  };
}

export async function fetchAssets(
  actor: Employee,
  canManageAssets: boolean
): Promise<CompanyAsset[]> {
  try {
    const actorCompanyId = normalizeCompanyId(actor.companyId);

    if (actor.role === 'super_admin') {
      const snap = await getDocs(
        query(collection(db, 'assets'), orderBy('createdAt', 'desc'), limit(500))
      );
      return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<CompanyAsset, 'id'>),
      }));
    }

    if (actor.role === 'team_leader' && canManageAssets) {
      const snap = await getDocs(
        query(collection(db, 'assets'), where('companyId', '==', actorCompanyId))
      );
      return snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<CompanyAsset, 'id'>) }))
        .sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt));
    }

    const snap = await getDocs(
      query(collection(db, 'assets'), where('assignedToEmployeeUid', '==', actor.uid))
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<CompanyAsset, 'id'>) }))
      .sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'assets');
  }
}

export async function fetchAssetAssignments(
  actor: Employee,
  canManageAssets: boolean,
  canViewAllEmployees = false
): Promise<AssetAssignment[]> {
  try {
    const actorCompanyId = normalizeCompanyId(actor.companyId);

    if (actor.role === 'super_admin') {
      const snap = await getDocs(
        query(collection(db, 'assetAssignments'), orderBy('createdAt', 'desc'), limit(500))
      );
      return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AssetAssignment, 'id'>),
      }));
    }

    if (actor.role === 'team_leader' && (canManageAssets || canViewAllEmployees)) {
      const snap = await getDocs(
        query(collection(db, 'assetAssignments'), where('companyId', '==', actorCompanyId))
      );
      return snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<AssetAssignment, 'id'>) }))
        .sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt));
    }

    if (actor.role === 'team_leader') {
      const [ownSnap, teamSnap] = await Promise.all([
        getDocs(query(collection(db, 'assetAssignments'), where('employeeUid', '==', actor.uid))),
        getDocs(
          query(
            collection(db, 'assetAssignments'),
            where('companyId', '==', actorCompanyId),
            where('managerUid', '==', actor.uid)
          )
        ),
      ]);
      const map = new Map<string, AssetAssignment>();
      for (const d of [...ownSnap.docs, ...teamSnap.docs]) {
        map.set(d.id, { id: d.id, ...(d.data() as Omit<AssetAssignment, 'id'>) });
      }
      return Array.from(map.values()).sort(
        (a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt)
      );
    }

    const snap = await getDocs(
      query(collection(db, 'assetAssignments'), where('employeeUid', '==', actor.uid))
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<AssetAssignment, 'id'>) }))
      .sort((a, b) => timestampToMs(b.createdAt) - timestampToMs(a.createdAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'assetAssignments');
  }
}

export async function createCompanyAsset(params: {
  actor: Employee;
  canManageAssets: boolean;
  assetTag: string;
  name: string;
  category: AssetCategory;
  brand?: string;
  model?: string;
  serialNumber?: string;
  purchaseDate?: string;
  purchaseCost?: number;
  currency?: SupportedCurrency;
  warrantyExpiry?: string;
  condition: AssetCondition;
  status?: Exclude<AssetStatus, 'Assigned'>;
  companyId: CompanyId;
  notes?: string;
  photoAssetId?: string;
}): Promise<CompanyAsset> {
  const isSuperAdmin = params.actor.role === 'super_admin';
  const isAllowedLeader = params.actor.role === 'team_leader' && params.canManageAssets;
  if (!isSuperAdmin && !isAllowedLeader) {
    throw new Error('Only Super Admins or authorized Asset Managers can register company assets.');
  }

  const companyId = normalizeCompanyId(params.companyId);
  if (!isSuperAdmin && companyId !== normalizeCompanyId(params.actor.companyId)) {
    throw new Error('Cross-company asset creation is restricted to Super Admin.');
  }
  if (!ASSET_CATEGORIES.includes(params.category)) {
    throw new Error('Invalid asset category.');
  }
  if (!ASSET_CONDITIONS.includes(params.condition)) {
    throw new Error('Invalid asset condition.');
  }
  const status: AssetStatus = (params.status || 'Available') as AssetStatus;
  if (!ASSET_STATUSES.includes(status) || status === 'Assigned') {
    throw new Error('New assets must start as Available, Under repair, Lost, or Retired.');
  }

  const assetTag = params.assetTag.trim().toUpperCase();
  const name = params.name.trim();
  if (!assetTag || assetTag.length > 60) {
    throw new Error('Asset ID / Tag is required (max 60 characters).');
  }
  if (!name || name.length > 120) {
    throw new Error('Asset name is required (max 120 characters).');
  }

  const hasCost = typeof params.purchaseCost === 'number' && !Number.isNaN(params.purchaseCost);
  const purchaseCost = hasCost ? Math.round(params.purchaseCost! * 100) / 100 : undefined;
  if (purchaseCost !== undefined && (purchaseCost < 0 || purchaseCost > 100000000)) {
    throw new Error('Purchase cost must be zero or positive.');
  }
  const currency = params.currency
    ? assertCurrencyAllowedForCompany(companyId, params.currency)
    : companyId === 'mygrade'
    ? 'INR'
    : 'INR';

  const callerUid = auth.currentUser?.uid || params.actor.uid;
  const callerName = (params.actor.fullName || params.actor.email || 'Admin').trim().slice(0, 120);
  const id = makeSafeId('ast');

  const payload = cleanObject({
    assetTag,
    name,
    category: params.category,
    brand: params.brand?.trim().slice(0, 80) || undefined,
    model: params.model?.trim().slice(0, 80) || undefined,
    serialNumber: params.serialNumber?.trim().slice(0, 100) || undefined,
    purchaseDate: params.purchaseDate?.trim() || undefined,
    purchaseCost,
    currency,
    warrantyExpiry: params.warrantyExpiry?.trim() || undefined,
    condition: params.condition,
    status,
    companyId,
    notes: params.notes?.trim().slice(0, 500) || undefined,
    photoAssetId: params.photoAssetId?.trim().slice(0, 128) || undefined,
    createdByUid: callerUid,
    createdByName: callerName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(doc(db, 'assets', id), payload);
    await writeAuditLog({
      actor: params.actor,
      action: 'ASSET_CREATED',
      entityType: 'CompanyAsset',
      entityId: id,
      updatedValues: {
        assetTag,
        name,
        category: params.category,
        companyId,
        condition: params.condition,
        status,
      },
      summary: `Registered asset ${assetTag} (${name} · ${params.category}) under ${companyId === 'mygrade' ? 'MyGrade' : 'TalentGrade'}.`,
    });
    return {
      id,
      ...(payload as unknown as Omit<CompanyAsset, 'id'>),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `assets/${id}`);
  }
}

export async function updateCompanyAsset(params: {
  assetId: string;
  actor: Employee;
  canManageAssets: boolean;
  assetTag: string;
  name: string;
  category: AssetCategory;
  brand?: string;
  model?: string;
  serialNumber?: string;
  purchaseDate?: string;
  purchaseCost?: number;
  currency?: SupportedCurrency;
  warrantyExpiry?: string;
  condition: AssetCondition;
  status: AssetStatus;
  companyId: CompanyId;
  notes?: string;
  photoAssetId?: string;
}): Promise<void> {
  const isSuperAdmin = params.actor.role === 'super_admin';
  const isAllowedLeader = params.actor.role === 'team_leader' && params.canManageAssets;
  if (!isSuperAdmin && !isAllowedLeader) {
    throw new Error('You do not have permission to update assets.');
  }

  const assetTag = params.assetTag.trim().toUpperCase();
  const name = params.name.trim();
  if (!assetTag || !name) {
    throw new Error('Asset tag and asset name are required.');
  }

  const ref = doc(db, 'assets', params.assetId);
  const actorCompanyId = normalizeCompanyId(params.actor.companyId);

  try {
    let previousValues: Record<string, unknown> = {};
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Asset record not found.');
      const existing = snap.data() as CompanyAsset;

      if (!isSuperAdmin) {
        if (existing.companyId !== actorCompanyId) {
          throw new Error('Cross-company asset edits are restricted to Super Admin.');
        }
        if (normalizeCompanyId(params.companyId) !== existing.companyId) {
          throw new Error('Only Super Admins can transfer assets between companies.');
        }
      }

      if (existing.currentAssignmentId && params.status !== 'Assigned') {
        throw new Error('Assigned assets must be processed via the Return Asset workflow.');
      }
      if (!existing.currentAssignmentId && params.status === 'Assigned') {
        throw new Error('Use Assign Asset to allocate this asset to an employee.');
      }

      const targetCompany = normalizeCompanyId(params.companyId);
      const safeCurrency = params.currency
        ? assertCurrencyAllowedForCompany(targetCompany, params.currency)
        : existing.currency || 'INR';
      const hasCost = typeof params.purchaseCost === 'number' && !Number.isNaN(params.purchaseCost);
      const purchaseCost = hasCost ? Math.round(params.purchaseCost! * 100) / 100 : undefined;

      previousValues = {
        assetTag: existing.assetTag,
        name: existing.name,
        condition: existing.condition,
        status: existing.status,
      };

      const nextDoc: Record<string, unknown> = {
        assetTag,
        name,
        category: params.category,
        brand: params.brand?.trim().slice(0, 80) || '',
        model: params.model?.trim().slice(0, 80) || '',
        serialNumber: params.serialNumber?.trim().slice(0, 100) || '',
        purchaseDate: params.purchaseDate?.trim() || '',
        currency: safeCurrency,
        warrantyExpiry: params.warrantyExpiry?.trim() || '',
        condition: params.condition,
        status: params.status,
        companyId: targetCompany,
        notes: params.notes?.trim().slice(0, 500) || '',
        updatedAt: serverTimestamp(),
      };
      if (purchaseCost !== undefined) {
        nextDoc.purchaseCost = purchaseCost;
      } else if ('purchaseCost' in existing) {
        nextDoc.purchaseCost = deleteField();
      }
      if (params.photoAssetId !== undefined) {
        nextDoc.photoAssetId = params.photoAssetId ? params.photoAssetId.slice(0, 128) : '';
      }

      tx.update(ref, nextDoc);
    });

    await writeAuditLog({
      actor: params.actor,
      action: 'ASSET_UPDATED',
      entityType: 'CompanyAsset',
      entityId: params.assetId,
      previousValues,
      updatedValues: {
        assetTag,
        name,
        condition: params.condition,
        status: params.status,
      },
      summary: `Updated asset ${assetTag} (${name}) — Status: ${params.status}, Condition: ${params.condition}.`,
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('not found') ||
        err.message.includes('Return Asset') ||
        err.message.includes('Assign Asset') ||
        err.message.includes('Cross-company') ||
        err.message.includes('transfer') ||
        err.message.includes('MyGrade'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `assets/${params.assetId}`);
  }
}

export async function assignAssetToEmployee(params: {
  assetId: string;
  targetEmployee: Employee;
  actor: Employee;
  canManageAssets: boolean;
  assignedDate: string;
  conditionOnAssign: AssetCondition;
  assignRemarks?: string;
}): Promise<AssetAssignment> {
  const isSuperAdmin = params.actor.role === 'super_admin';
  const isAllowedLeader = params.actor.role === 'team_leader' && params.canManageAssets;
  if (!isSuperAdmin && !isAllowedLeader) {
    throw new Error('You do not have permission to assign assets.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.assignedDate.trim())) {
    throw new Error('Assignment date must be in YYYY-MM-DD format.');
  }

  const actorUid = auth.currentUser?.uid || params.actor.uid;
  const actorName = (params.actor.fullName || params.actor.email || 'Admin').trim().slice(0, 120);
  const actorCompanyId = normalizeCompanyId(params.actor.companyId);
  const targetCompanyId = normalizeCompanyId(params.targetEmployee.companyId);
  const assignmentId = makeSafeId('asg');
  const nowIso = new Date().toISOString();
  const assetRef = doc(db, 'assets', params.assetId);
  const assignmentRef = doc(db, 'assetAssignments', assignmentId);

  let createdAssignment: AssetAssignment | null = null;

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(assetRef);
      if (!snap.exists()) {
        throw new Error('Asset record not found.');
      }
      const asset = { id: snap.id, ...(snap.data() as Omit<CompanyAsset, 'id'>) };

      if (!isSuperAdmin && asset.companyId !== actorCompanyId) {
        throw new Error('Cross-company asset assignment is restricted to Super Admin.');
      }
      if (asset.companyId !== targetCompanyId) {
        throw new Error(
          `Company mismatch: ${asset.assetTag} belongs to ${asset.companyId === 'mygrade' ? 'MyGrade' : 'TalentGrade'}, whereas ${params.targetEmployee.fullName} belongs to ${targetCompanyId === 'mygrade' ? 'MyGrade' : 'TalentGrade'}.`
        );
      }
      if (asset.status !== 'Available' || asset.currentAssignmentId) {
        throw new Error(`Asset ${asset.assetTag} is currently ${asset.status} and cannot be assigned.`);
      }

      const assignmentPayload = cleanObject({
        assetId: asset.id,
        assetTag: asset.assetTag,
        assetName: asset.name,
        assetCategory: asset.category,
        serialNumber: asset.serialNumber || undefined,
        photoAssetId: asset.photoAssetId || undefined,
        companyId: asset.companyId,
        employeeId: params.targetEmployee.id,
        employeeUid: params.targetEmployee.uid || '',
        employeeCode: (params.targetEmployee.employeeCode || 'EMP').slice(0, 40),
        employeeName: params.targetEmployee.fullName.slice(0, 120),
        department: (params.targetEmployee.department || 'General').slice(0, 80),
        managerUid: params.targetEmployee.managerUid || undefined,
        assignedDate: params.assignedDate.trim(),
        assignedByUid: actorUid,
        assignedByName: actorName,
        conditionOnAssign: params.conditionOnAssign,
        assignRemarks: params.assignRemarks?.trim().slice(0, 500) || undefined,
        acknowledged: false,
        returned: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.set(assignmentRef, assignmentPayload);
      tx.update(assetRef, {
        status: 'Assigned',
        condition: params.conditionOnAssign,
        currentAssignmentId: assignmentId,
        assignedToEmployeeId: params.targetEmployee.id,
        assignedToEmployeeUid: params.targetEmployee.uid || '',
        assignedToEmployeeName: params.targetEmployee.fullName.slice(0, 120),
        assignedAtIso: nowIso,
        updatedAt: serverTimestamp(),
      });

      createdAssignment = {
        id: assignmentId,
        ...(assignmentPayload as unknown as Omit<AssetAssignment, 'id'>),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    });

    await writeAuditLog({
      actor: params.actor,
      action: 'ASSET_ASSIGNED',
      entityType: 'CompanyAsset',
      entityId: params.assetId,
      updatedValues: {
        assignmentId,
        employeeId: params.targetEmployee.id,
        employeeName: params.targetEmployee.fullName,
        assignedDate: params.assignedDate,
        conditionOnAssign: params.conditionOnAssign,
      },
      summary: `Assigned ${createdAssignment!.assetTag} (${createdAssignment!.assetName}) to ${params.targetEmployee.fullName} (${params.targetEmployee.employeeCode}).`,
    });

    return createdAssignment!;
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('not found') ||
        err.message.includes('Company mismatch') ||
        err.message.includes('cannot be assigned') ||
        err.message.includes('Cross-company'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `assets/${params.assetId}`);
  }
}

export async function acknowledgeAssetAssignment(params: {
  assignmentId: string;
  actor: Employee;
}): Promise<void> {
  const callerUid = auth.currentUser?.uid || params.actor.uid;
  const callerName = (params.actor.fullName || params.actor.email || 'Employee').trim().slice(0, 120);
  const nowIso = new Date().toISOString();
  const ref = doc(db, 'assetAssignments', params.assignmentId);

  let assignmentSnap: AssetAssignment | null = null;

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new Error('Asset assignment record not found.');
      }
      const existing = { id: snap.id, ...(snap.data() as Omit<AssetAssignment, 'id'>) };
      assignmentSnap = existing;

      if (existing.employeeUid !== callerUid) {
        throw new Error('Only the assigned employee can confirm receipt of this asset.');
      }
      if (existing.returned) {
        throw new Error('This asset assignment has already been returned.');
      }
      if (existing.acknowledged) {
        throw new Error('Receipt of this asset has already been confirmed.');
      }

      tx.update(ref, {
        acknowledged: true,
        acknowledgedByUid: callerUid,
        acknowledgedByName: callerName,
        acknowledgedAtIso: nowIso,
        acknowledgedAt: serverTimestamp(),
        acknowledgmentStatement: ASSET_ACKNOWLEDGMENT_NOTICE.slice(0, 300),
        updatedAt: serverTimestamp(),
      });
    });

    const a = assignmentSnap as AssetAssignment | null;
    await writeAuditLog({
      actor: params.actor,
      action: 'ASSET_ACKNOWLEDGED',
      entityType: 'AssetAssignment',
      entityId: params.assignmentId,
      updatedValues: {
        assetId: a?.assetId,
        assetTag: a?.assetTag,
        acknowledgedAtIso: nowIso,
      },
      summary: `${callerName} confirmed custody receipt of asset ${a?.assetTag || params.assignmentId} (${a?.assetName || ''}).`,
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('not found') ||
        err.message.includes('assigned employee') ||
        err.message.includes('already been'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `assetAssignments/${params.assignmentId}`);
  }
}

export async function returnAssignedAsset(params: {
  assignmentId: string;
  actor: Employee;
  canManageAssets: boolean;
  returnDate: string;
  returnCondition: AssetCondition;
  nextAssetStatus: Exclude<AssetStatus, 'Assigned'>;
  returnRemarks?: string;
}): Promise<void> {
  const isSuperAdmin = params.actor.role === 'super_admin';
  const isAllowedLeader = params.actor.role === 'team_leader' && params.canManageAssets;
  if (!isSuperAdmin && !isAllowedLeader) {
    throw new Error('You do not have permission to process asset returns.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.returnDate.trim())) {
    throw new Error('Return date must be in YYYY-MM-DD format.');
  }

  const actorUid = auth.currentUser?.uid || params.actor.uid;
  const actorName = (params.actor.fullName || params.actor.email || 'Admin').trim().slice(0, 120);
  const actorCompanyId = normalizeCompanyId(params.actor.companyId);
  const assignmentRef = doc(db, 'assetAssignments', params.assignmentId);

  let assignmentSnap: AssetAssignment | null = null;

  try {
    await runTransaction(db, async (tx) => {
      const asgSnap = await tx.get(assignmentRef);
      if (!asgSnap.exists()) {
        throw new Error('Asset assignment record not found.');
      }
      const existingAsg = { id: asgSnap.id, ...(asgSnap.data() as Omit<AssetAssignment, 'id'>) };
      assignmentSnap = existingAsg;

      if (!isSuperAdmin && existingAsg.companyId !== actorCompanyId) {
        throw new Error('Cross-company asset return processing is restricted to Super Admin.');
      }
      if (existingAsg.returned) {
        throw new Error('This asset assignment has already been marked returned.');
      }

      const assetRef = doc(db, 'assets', existingAsg.assetId);
      const assetSnap = await tx.get(assetRef);

      tx.update(assignmentRef, {
        returned: true,
        returnDate: params.returnDate.trim(),
        returnCondition: params.returnCondition,
        returnRemarks: params.returnRemarks?.trim().slice(0, 500) || '',
        returnedByAdminUid: actorUid,
        returnedByAdminName: actorName,
        returnedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (assetSnap.exists()) {
        tx.update(assetRef, {
          status: params.nextAssetStatus,
          condition: params.returnCondition,
          currentAssignmentId: deleteField(),
          assignedToEmployeeId: deleteField(),
          assignedToEmployeeUid: deleteField(),
          assignedToEmployeeName: deleteField(),
          assignedAtIso: deleteField(),
          updatedAt: serverTimestamp(),
        });
      }
    });

    const a = assignmentSnap as AssetAssignment | null;
    await writeAuditLog({
      actor: params.actor,
      action: 'ASSET_RETURNED',
      entityType: 'AssetAssignment',
      entityId: params.assignmentId,
      previousValues: { returned: false, status: 'Assigned' },
      updatedValues: {
        returned: true,
        returnDate: params.returnDate,
        returnCondition: params.returnCondition,
        nextAssetStatus: params.nextAssetStatus,
      },
      summary: `Recorded return of ${a?.assetTag || ''} from ${a?.employeeName || 'employee'} -> Asset status: ${params.nextAssetStatus} (${params.returnCondition}).`,
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('not found') ||
        err.message.includes('already been') ||
        err.message.includes('Cross-company'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `assetAssignments/${params.assignmentId}`);
  }
}
