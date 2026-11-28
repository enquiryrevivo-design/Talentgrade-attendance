import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  History,
  Laptop,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  UserPlus,
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
  ASSET_CATEGORIES,
  ASSET_CONDITIONS,
  ASSET_STATUSES,
  AssetAssignment,
  AssetCategory,
  AssetCondition,
  AssetStatus,
  CompanyAsset,
  CompanyId,
  Employee,
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
  acknowledgeAssetAssignment,
  ASSET_ACKNOWLEDGMENT_NOTICE,
  assignAssetToEmployee,
  computeEmployeeAssetClearance,
  createCompanyAsset,
  fetchAssetAssignments,
  fetchAssets,
  returnAssignedAsset,
  updateCompanyAsset,
} from '../lib/assetService';

const ASSET_STATUS_STYLE: Record<AssetStatus, string> = {
  Available: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
  Assigned: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
  'Under repair': 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  Lost: 'bg-red-50 text-[#B5121B] border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
  Retired: 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
};

export function AssetsView() {
  const { employee, settings } = useAuth();
  const { showToast } = useToast();

  const todayLocal = getTodayInTimezone(
    employee && settings ? getEffectiveSchedule(employee, settings).timezone : 'Asia/Kolkata'
  );

  const isSuperAdmin = employee?.role === 'super_admin';
  const canManageAssets = Boolean(
    isSuperAdmin || (employee?.role === 'team_leader' && settings?.teamLeaderPermissions?.canManageAssets)
  );
  const myCompanyId = normalizeCompanyId(employee?.companyId);

  const [tab, setTab] = useState<'my' | 'inventory' | 'clearance'>(() =>
    canManageAssets ? 'inventory' : 'my'
  );
  const [assets, setAssets] = useState<CompanyAsset[]>([]);
  const [assignments, setAssignments] = useState<AssetAssignment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState<'all' | CompanyId>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | AssetCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | AssetStatus>('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');

  // Create / Edit Asset Modal
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<CompanyAsset | null>(null);
  const [savingAsset, setSavingAsset] = useState(false);
  const [assetPhoto, setAssetPhoto] = useState<UploadedAttachmentInfo | null>(null);
  const [assetForm, setAssetForm] = useState({
    assetTag: '',
    name: '',
    category: 'Laptop' as AssetCategory,
    brand: '',
    model: '',
    serialNumber: '',
    purchaseDate: '',
    purchaseCost: '',
    currency: 'INR' as SupportedCurrency,
    warrantyExpiry: '',
    condition: 'New' as AssetCondition,
    status: 'Available' as AssetStatus,
    companyId: myCompanyId as CompanyId,
    notes: '',
  });

  // Assign Modal
  const [assignTarget, setAssignTarget] = useState<CompanyAsset | null>(null);
  const [assignForm, setAssignForm] = useState({
    employeeId: '',
    assignedDate: todayLocal,
    conditionOnAssign: 'Good' as AssetCondition,
    assignRemarks: '',
  });
  const [assigning, setAssigning] = useState(false);

  // Return Modal
  const [returnTarget, setReturnTarget] = useState<AssetAssignment | null>(null);
  const [returnForm, setReturnForm] = useState({
    returnDate: todayLocal,
    returnCondition: 'Good' as AssetCondition,
    nextAssetStatus: 'Available' as Exclude<AssetStatus, 'Assigned'>,
    returnRemarks: '',
  });
  const [returning, setReturning] = useState(false);

  // Employee Acknowledgment Modal
  const [ackTarget, setAckTarget] = useState<AssetAssignment | null>(null);
  const [ackChecked, setAckChecked] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);

  // History & Photo preview
  const [historyAsset, setHistoryAsset] = useState<CompanyAsset | null>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('Asset Photo');

  const loadData = useCallback(async () => {
    if (!employee || !settings) return;
    setLoading(true);
    try {
      const canViewAll = settings.teamLeaderPermissions?.canViewAllEmployees ?? true;
      const [assetList, assignmentList, empList] = await Promise.all([
        fetchAssets(employee, canManageAssets),
        fetchAssetAssignments(employee, canManageAssets, canViewAll),
        canManageAssets ? fetchAllEmployees(employee, canViewAll) : Promise.resolve([]),
      ]);
      setAssets(assetList);
      setAssignments(assignmentList);
      setEmployees(empList);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load assets', 'error');
    } finally {
      setLoading(false);
    }
  }, [employee, settings, canManageAssets, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (canManageAssets && tab === 'my' && isSuperAdmin) {
      setTab('inventory');
    }
  }, [canManageAssets, isSuperAdmin, tab]);

  const myAssignments = useMemo(
    () => (employee ? assignments.filter((a) => a.employeeUid === employee.uid) : []),
    [assignments, employee]
  );

  const myActiveAssignments = useMemo(
    () => myAssignments.filter((a) => !a.returned),
    [myAssignments]
  );

  const myPendingAckCount = useMemo(
    () => myActiveAssignments.filter((a) => !a.acknowledged).length,
    [myActiveAssignments]
  );

  const filteredAssets = useMemo(() => {
    return assets.filter((a) => {
      if (companyFilter !== 'all' && a.companyId !== companyFilter) return false;
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (employeeFilter !== 'all' && a.assignedToEmployeeId !== employeeFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          a.assetTag.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          (a.brand || '').toLowerCase().includes(q) ||
          (a.model || '').toLowerCase().includes(q) ||
          (a.serialNumber || '').toLowerCase().includes(q) ||
          (a.assignedToEmployeeName || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [assets, companyFilter, categoryFilter, statusFilter, employeeFilter, search]);

  const exitEmployeesWithClearance = useMemo(() => {
    if (!canManageAssets) return [];
    return employees
      .filter((e) => e.status === 'Resigned' || e.status === 'Terminated' || e.status === 'Inactive')
      .filter((e) => companyFilter === 'all' || normalizeCompanyId(e.companyId) === companyFilter)
      .map((emp) => ({
        employee: emp,
        clearance: computeEmployeeAssetClearance(emp.id, assignments, assets),
      }))
      .sort(
        (a, b) =>
          b.clearance.currentlyAssigned.length +
          b.clearance.lostAssets.length -
          (a.clearance.currentlyAssigned.length + a.clearance.lostAssets.length)
      );
  }, [canManageAssets, employees, assignments, assets, companyFilter]);

  if (!employee || !settings) return null;

  const openCreateModal = () => {
    setEditingAsset(null);
    setAssetPhoto(null);
    const defaultCo = isSuperAdmin ? 'talentgrade' : myCompanyId;
    setAssetForm({
      assetTag: `AST-${String(assets.length + 1).padStart(3, '0')}`,
      name: '',
      category: 'Laptop',
      brand: '',
      model: '',
      serialNumber: '',
      purchaseDate: '',
      purchaseCost: '',
      currency: 'INR',
      warrantyExpiry: '',
      condition: 'New',
      status: 'Available',
      companyId: defaultCo,
      notes: '',
    });
    setAssetModalOpen(true);
  };

  const openEditModal = (asset: CompanyAsset) => {
    setEditingAsset(asset);
    setAssetPhoto(
      asset.photoAssetId
        ? { assetId: asset.photoAssetId, fileName: 'Asset Photo', mimeType: 'image/jpeg' }
        : null
    );
    setAssetForm({
      assetTag: asset.assetTag,
      name: asset.name,
      category: asset.category,
      brand: asset.brand || '',
      model: asset.model || '',
      serialNumber: asset.serialNumber || '',
      purchaseDate: asset.purchaseDate || '',
      purchaseCost: typeof asset.purchaseCost === 'number' ? String(asset.purchaseCost) : '',
      currency: asset.companyId === 'mygrade' ? 'INR' : asset.currency || 'INR',
      warrantyExpiry: asset.warrantyExpiry || '',
      condition: asset.condition,
      status: asset.status,
      companyId: asset.companyId,
      notes: asset.notes || '',
    });
    setAssetModalOpen(true);
  };

  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAsset(true);
    try {
      const parsedCost =
        assetForm.purchaseCost.trim() !== '' ? Number(assetForm.purchaseCost) : undefined;
      const safeCurrency: SupportedCurrency =
        assetForm.companyId === 'mygrade' ? 'INR' : assetForm.currency;

      if (editingAsset) {
        await updateCompanyAsset({
          assetId: editingAsset.id,
          actor: employee,
          canManageAssets,
          assetTag: assetForm.assetTag,
          name: assetForm.name,
          category: assetForm.category,
          brand: assetForm.brand,
          model: assetForm.model,
          serialNumber: assetForm.serialNumber,
          purchaseDate: assetForm.purchaseDate,
          purchaseCost: parsedCost,
          currency: safeCurrency,
          warrantyExpiry: assetForm.warrantyExpiry,
          condition: assetForm.condition,
          status: editingAsset.currentAssignmentId ? 'Assigned' : assetForm.status,
          companyId: assetForm.companyId,
          notes: assetForm.notes,
          photoAssetId: assetPhoto?.assetId ?? '',
        });
        showToast('Asset details updated.', 'success');
      } else {
        await createCompanyAsset({
          actor: employee,
          canManageAssets,
          assetTag: assetForm.assetTag,
          name: assetForm.name,
          category: assetForm.category,
          brand: assetForm.brand,
          model: assetForm.model,
          serialNumber: assetForm.serialNumber,
          purchaseDate: assetForm.purchaseDate,
          purchaseCost: parsedCost,
          currency: safeCurrency,
          warrantyExpiry: assetForm.warrantyExpiry,
          condition: assetForm.condition,
          status: assetForm.status === 'Assigned' ? 'Available' : assetForm.status,
          companyId: assetForm.companyId,
          notes: assetForm.notes,
          photoAssetId: assetPhoto?.assetId,
        });
        showToast('Asset registered.', 'success');
      }
      setAssetModalOpen(false);
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not save asset', 'error');
    } finally {
      setSavingAsset(false);
    }
  };

  const openAssignModal = (asset: CompanyAsset) => {
    const eligible = employees.filter(
      (emp) => emp.status === 'Active' && normalizeCompanyId(emp.companyId) === asset.companyId
    );
    setAssignTarget(asset);
    setAssignForm({
      employeeId: eligible[0]?.id || '',
      assignedDate: todayLocal,
      conditionOnAssign: asset.condition,
      assignRemarks: '',
    });
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTarget) return;
    const targetEmp = employees.find((emp) => emp.id === assignForm.employeeId);
    if (!targetEmp) {
      showToast('Select an active employee from the same company.', 'error');
      return;
    }
    setAssigning(true);
    try {
      await assignAssetToEmployee({
        assetId: assignTarget.id,
        targetEmployee: targetEmp,
        actor: employee,
        canManageAssets,
        assignedDate: assignForm.assignedDate,
        conditionOnAssign: assignForm.conditionOnAssign,
        assignRemarks: assignForm.assignRemarks,
      });
      showToast(`Assigned ${assignTarget.assetTag} to ${targetEmp.fullName}.`, 'success');
      setAssignTarget(null);
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Assignment failed', 'error');
    } finally {
      setAssigning(false);
    }
  };

  const openReturnModalByAsset = (asset: CompanyAsset) => {
    const activeAsg = assignments.find(
      (a) => a.id === asset.currentAssignmentId || (a.assetId === asset.id && !a.returned)
    );
    if (!activeAsg) {
      showToast('Active assignment record not found for this asset.', 'error');
      return;
    }
    setReturnTarget(activeAsg);
    setReturnForm({
      returnDate: todayLocal,
      returnCondition: asset.condition,
      nextAssetStatus: 'Available',
      returnRemarks: '',
    });
  };

  const openReturnModalByAssignment = (asg: AssetAssignment) => {
    setReturnTarget(asg);
    setReturnForm({
      returnDate: todayLocal,
      returnCondition: asg.conditionOnAssign,
      nextAssetStatus: 'Available',
      returnRemarks: '',
    });
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnTarget) return;
    setReturning(true);
    try {
      await returnAssignedAsset({
        assignmentId: returnTarget.id,
        actor: employee,
        canManageAssets,
        returnDate: returnForm.returnDate,
        returnCondition: returnForm.returnCondition,
        nextAssetStatus: returnForm.nextAssetStatus,
        returnRemarks: returnForm.returnRemarks,
      });
      showToast(`Returned ${returnTarget.assetTag} (${returnForm.nextAssetStatus}).`, 'success');
      setReturnTarget(null);
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Return processing failed', 'error');
    } finally {
      setReturning(false);
    }
  };

  const handleConfirmAcknowledgment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ackTarget || !ackChecked) return;
    setAcknowledging(true);
    try {
      await acknowledgeAssetAssignment({
        assignmentId: ackTarget.id,
        actor: employee,
      });
      showToast(`Receipt confirmed for ${ackTarget.assetTag}.`, 'success');
      setAckTarget(null);
      setAckChecked(false);
      await loadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not confirm receipt', 'error');
    } finally {
      setAcknowledging(false);
    }
  };

  const handleExportCsv = () => {
    if (tab === 'my') {
      exportToCsv(
        `my_assets_${todayLocal}.csv`,
        ['Asset Tag', 'Name', 'Category', 'Serial', 'Company', 'Assigned Date', 'Condition', 'Acknowledged', 'Returned', 'Return Date'],
        myAssignments.map((a) => [
          a.assetTag,
          a.assetName,
          a.assetCategory,
          a.serialNumber || '',
          getCompanyShortName(a.companyId),
          a.assignedDate,
          a.conditionOnAssign,
          a.acknowledged ? `Yes (${a.acknowledgedAtIso || ''})` : 'Pending',
          a.returned ? 'Returned' : 'In Custody',
          a.returnDate || '',
        ])
      );
    } else {
      exportToCsv(
        `company_assets_${todayLocal}.csv`,
        ['Asset Tag', 'Name', 'Category', 'Brand', 'Model', 'Serial Number', 'Company', 'Status', 'Condition', 'Assigned To', 'Purchase Cost', 'Currency', 'Warranty Expiry'],
        filteredAssets.map((a) => [
          a.assetTag,
          a.name,
          a.category,
          a.brand || '',
          a.model || '',
          a.serialNumber || '',
          getCompanyShortName(a.companyId),
          a.status,
          a.condition,
          a.assignedToEmployeeName || 'Unassigned',
          a.purchaseCost ?? '',
          a.currency || '',
          a.warrantyExpiry || '',
        ])
      );
    }
    showToast('Asset report exported to CSV.', 'success');
  };

  const totalPendingExitReturns = exitEmployeesWithClearance.reduce(
    (sum, item) => sum + item.clearance.currentlyAssigned.length + item.clearance.lostAssets.length,
    0
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold text-zinc-950 dark:text-zinc-100">
            Asset Management System
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Company equipment registry, custody assignment, employee receipt confirmation, returns &amp; exit clearance
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
          {canManageAssets && (
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[42px] px-5 py-2 rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Register Asset
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-zinc-200/70 dark:bg-zinc-800 text-xs overflow-x-auto">
        <button
          type="button"
          onClick={() => setTab('my')}
          className={`px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2 whitespace-nowrap ${
            tab === 'my'
              ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
              : 'text-zinc-600 dark:text-zinc-400'
          }`}
        >
          My Assets ({myActiveAssignments.length})
          {myPendingAckCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-[#B5121B] text-white text-[10px] font-mono">
              {myPendingAckCount} new
            </span>
          )}
        </button>

        {canManageAssets && (
          <>
            <button
              type="button"
              onClick={() => setTab('inventory')}
              className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap ${
                tab === 'inventory'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              Asset Registry ({assets.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('clearance')}
              className={`px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2 whitespace-nowrap ${
                tab === 'clearance'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              Exit Clearance
              {totalPendingExitReturns > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-600 text-white text-[10px] font-mono">
                  {totalPendingExitReturns} due
                </span>
              )}
            </button>
          </>
        )}
      </div>

      {/* MY ASSETS SCREEN */}
      {tab === 'my' && (
        <div className="space-y-6">
          {myPendingAckCount > 0 && (
            <div className="p-4 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 flex items-start gap-3 text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-amber-950 dark:text-amber-200">
                  {myPendingAckCount} assigned asset{myPendingAckCount === 1 ? '' : 's'} awaiting custody confirmation
                </div>
                <p className="text-amber-800 dark:text-amber-300 mt-0.5">
                  Review each asset&apos;s tag, serial number, and condition below and confirm digital receipt.
                </p>
              </div>
            </div>
          )}

          {/* Currently Assigned Assets */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
              Currently Assigned Assets ({myActiveAssignments.length})
            </h2>
            {loading ? (
              <div className="h-28 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 animate-pulse" />
            ) : myActiveAssignments.length === 0 ? (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 text-center text-xs text-zinc-500">
                No company assets are currently assigned to you.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {myActiveAssignments.map((asg) => (
                  <div
                    key={asg.id}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-[11px] font-bold text-[#B5121B] dark:text-red-400">
                          {asg.assetTag}
                        </span>
                        <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100 mt-0.5">
                          {asg.assetName}
                        </h3>
                        <p className="text-[11px] text-zinc-500">{asg.assetCategory}</p>
                      </div>
                      <CompanyBadge companyId={asg.companyId} />
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-[11px]">
                      <div>
                        <div className="text-zinc-500">Serial Number</div>
                        <div className="font-mono font-medium">{asg.serialNumber || '—'}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500">Condition</div>
                        <div className="font-medium">{asg.conditionOnAssign}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500">Assigned Date</div>
                        <div className="font-mono">{asg.assignedDate}</div>
                      </div>
                      <div>
                        <div className="text-zinc-500">Custody Status</div>
                        <div className="font-semibold">
                          {asg.acknowledged ? (
                            <span className="text-emerald-700 dark:text-emerald-400">Confirmed</span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400">Awaiting Confirmation</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {asg.acknowledged ? (
                      <div className="p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>
                          Receipt confirmed on{' '}
                          <span className="font-mono">{asg.acknowledgedAtIso?.slice(0, 10) || asg.assignedDate}</span>
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setAckTarget(asg);
                          setAckChecked(false);
                        }}
                        className="w-full min-h-[40px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold inline-flex items-center justify-center gap-1.5"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        Confirm Asset Receipt
                      </button>
                    )}

                    {asg.photoAssetId && (
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewTitle(`${asg.assetTag} · ${asg.assetName}`);
                          setPreviewAssetId(asg.photoAssetId!);
                        }}
                        className="w-full min-h-[34px] rounded-lg border border-zinc-200 dark:border-zinc-700 text-[11px] font-medium inline-flex items-center justify-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View Asset Photo
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Personal Assignment & Return History */}
          {myAssignments.length > 0 && (
            <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold">
                My Asset Assignment &amp; Return History ({myAssignments.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                      <th className="py-3 px-4">Asset</th>
                      <th className="py-3 px-4">Assigned</th>
                      <th className="py-3 px-4">Receipt Confirmed</th>
                      <th className="py-3 px-4">Return Status</th>
                      <th className="py-3 px-4">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {myAssignments.map((a) => (
                      <tr key={a.id}>
                        <td className="py-3 px-4">
                          <div className="font-mono font-semibold">{a.assetTag}</div>
                          <div className="text-zinc-500">{a.assetName}</div>
                        </td>
                        <td className="py-3 px-4 font-mono">
                          {a.assignedDate} ({a.conditionOnAssign})
                        </td>
                        <td className="py-3 px-4">
                          {a.acknowledged
                            ? `Confirmed (${a.acknowledgedAtIso?.slice(0, 10) || ''})`
                            : 'Pending'}
                        </td>
                        <td className="py-3 px-4">
                          {a.returned ? (
                            <span className="font-mono text-emerald-700 dark:text-emerald-400">
                              Returned {a.returnDate} ({a.returnCondition})
                            </span>
                          ) : (
                            <span className="text-sky-700 dark:text-sky-400 font-medium">In Custody</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-zinc-500">
                          {a.returnRemarks || a.assignRemarks || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {/* ADMIN INVENTORY TAB */}
      {tab === 'inventory' && canManageAssets && (
        <div className="space-y-5">
          {/* KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
              <div className="text-[11px] text-zinc-500">Total Assets</div>
              <div className="text-xl font-bold font-mono tabular-nums mt-1">{assets.length}</div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
              <div className="text-[11px] text-zinc-500">Available</div>
              <div className="text-xl font-bold font-mono tabular-nums mt-1 text-emerald-600 dark:text-emerald-400">
                {assets.filter((a) => a.status === 'Available').length}
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
              <div className="text-[11px] text-zinc-500">Assigned</div>
              <div className="text-xl font-bold font-mono tabular-nums mt-1 text-sky-600 dark:text-sky-400">
                {assets.filter((a) => a.status === 'Assigned').length}
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
              <div className="text-[11px] text-zinc-500">Under Repair</div>
              <div className="text-xl font-bold font-mono tabular-nums mt-1 text-amber-600 dark:text-amber-400">
                {assets.filter((a) => a.status === 'Under repair').length}
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
              <div className="text-[11px] text-zinc-500">Lost / Retired</div>
              <div className="text-xl font-bold font-mono tabular-nums mt-1 text-zinc-700 dark:text-zinc-300">
                {assets.filter((a) => a.status === 'Lost' || a.status === 'Retired').length}
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
              <div className="text-[11px] text-zinc-500">TG / MG Split</div>
              <div className="text-sm font-bold font-mono tabular-nums mt-2">
                {assets.filter((a) => a.companyId === 'talentgrade').length} TG ·{' '}
                {assets.filter((a) => a.companyId === 'mygrade').length} MG
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 text-xs">
            <div className="relative lg:col-span-2">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tag, name, brand, serial, assignee..."
                className="w-full min-h-[38px] pl-9 pr-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>

            {isSuperAdmin && (
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

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as 'all' | AssetCategory)}
              className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
            >
              <option value="all">All Categories</option>
              {ASSET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | AssetStatus)}
              className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
            >
              <option value="all">All Statuses</option>
              {ASSET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              value={employeeFilter}
              onChange={(e) => setEmployeeFilter(e.target.value)}
              className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
            >
              <option value="all">All Assignees</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName}
                </option>
              ))}
            </select>
          </div>

          {/* Inventory Table */}
          <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">
                <div className="h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                <div className="h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <Laptop className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto" />
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No assets registered</p>
                <p className="text-xs text-zinc-500">Click &quot;Register Asset&quot; to add company equipment.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500">
                      <th className="py-3 px-4 font-medium">Asset Tag &amp; Name</th>
                      <th className="py-3 px-4 font-medium">Company</th>
                      <th className="py-3 px-4 font-medium">Category · Serial</th>
                      <th className="py-3 px-4 font-medium">Status · Condition</th>
                      <th className="py-3 px-4 font-medium">Assigned Employee</th>
                      <th className="py-3 px-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {filteredAssets.map((a) => {
                      const activeAsg = a.currentAssignmentId
                        ? assignments.find((asg) => asg.id === a.currentAssignmentId)
                        : undefined;
                      return (
                        <tr key={a.id} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 align-top">
                          <td className="py-3 px-4">
                            <div className="font-mono font-bold text-zinc-950 dark:text-zinc-100">{a.assetTag}</div>
                            <div className="font-semibold text-zinc-800 dark:text-zinc-200">{a.name}</div>
                            {(a.brand || a.model) && (
                              <div className="text-[11px] text-zinc-500">
                                {[a.brand, a.model].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <CompanyBadge companyId={a.companyId} />
                          </td>
                          <td className="py-3 px-4">
                            <div>{a.category}</div>
                            <div className="text-[11px] font-mono text-zinc-500">
                              S/N: {a.serialNumber || '—'}
                            </div>
                            {typeof a.purchaseCost === 'number' && (
                              <div className="text-[11px] font-mono text-zinc-500">
                                Cost: {formatMoney(a.purchaseCost, a.currency || 'INR')}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap space-y-1">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-lg border text-[11px] font-semibold ${ASSET_STATUS_STYLE[a.status]}`}
                            >
                              {a.status}
                            </span>
                            <div className="text-[11px] text-zinc-500">Cond: {a.condition}</div>
                          </td>
                          <td className="py-3 px-4">
                            {a.status === 'Assigned' && a.assignedToEmployeeName ? (
                              <div>
                                <div className="font-semibold">{a.assignedToEmployeeName}</div>
                                <div className="text-[11px] text-zinc-500">
                                  {activeAsg?.acknowledged ? (
                                    <span className="text-emerald-700 dark:text-emerald-400">
                                      Receipt Confirmed ({activeAsg.acknowledgedAtIso?.slice(0, 10)})
                                    </span>
                                  ) : (
                                    <span className="text-amber-600 dark:text-amber-400">
                                      Pending Acknowledgment
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-zinc-400">Unassigned</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {a.status === 'Available' && (
                                <button
                                  type="button"
                                  onClick={() => openAssignModal(a)}
                                  className="min-h-[32px] px-2.5 py-1 rounded-lg bg-black dark:bg-white text-white dark:text-black font-semibold inline-flex items-center gap-1"
                                >
                                  <UserPlus className="w-3.5 h-3.5" />
                                  Assign
                                </button>
                              )}
                              {a.status === 'Assigned' && (
                                <button
                                  type="button"
                                  onClick={() => openReturnModalByAsset(a)}
                                  className="min-h-[32px] px-2.5 py-1 rounded-lg bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold inline-flex items-center gap-1"
                                >
                                  <ArrowLeftRight className="w-3.5 h-3.5" />
                                  Return
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setHistoryAsset(a)}
                                title="Assignment History"
                                className="min-h-[32px] px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                <History className="w-3.5 h-3.5" />
                              </button>
                              {a.photoAssetId && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPreviewTitle(`${a.assetTag} · ${a.name}`);
                                    setPreviewAssetId(a.photoAssetId!);
                                  }}
                                  title="View Photo"
                                  className="min-h-[32px] px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEditModal(a)}
                                title="Edit Asset"
                                className="min-h-[32px] px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
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
        </div>
      )}

      {/* EXIT CLEARANCE TAB */}
      {tab === 'clearance' && canManageAssets && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div>
              <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                Offboarding &amp; Exit Asset Clearance Checklist
              </h2>
              <p className="text-zinc-500 mt-0.5">
                Deactivated, resigned, and terminated employees retain their assigned asset accountability until formally returned.
              </p>
            </div>
            <span className="font-mono font-semibold text-[#B5121B]">
              {totalPendingExitReturns} unreturned asset(s)
            </span>
          </div>

          {exitEmployeesWithClearance.length === 0 ? (
            <div className="p-10 text-center text-xs text-zinc-500">
              No resigned, terminated, or inactive employees found.
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {exitEmployeesWithClearance.map(({ employee: emp, clearance }) => (
                <div key={emp.id} className="p-5 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-semibold text-sm">{emp.fullName}</span>
                      <span className="font-mono text-zinc-500">({emp.employeeCode})</span>
                      <CompanyBadge companyId={emp.companyId} />
                      <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium">
                        {emp.status}
                      </span>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-lg font-semibold ${
                        clearance.clearanceStatus === 'Pending Return'
                          ? 'bg-red-50 text-[#B5121B] border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900'
                          : 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
                      }`}
                    >
                      {clearance.clearanceStatus}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-zinc-500">
                    <span>Assigned: {clearance.assignments.length}</span>
                    <span>Returned: {clearance.returned.length}</span>
                    <span className={clearance.currentlyAssigned.length > 0 ? 'text-amber-700 dark:text-amber-400 font-semibold' : ''}>
                      Pending Return: {clearance.currentlyAssigned.length}
                    </span>
                    <span className={clearance.lostAssets.length > 0 ? 'text-[#B5121B] dark:text-red-400 font-semibold' : ''}>
                      Missing (Lost): {clearance.lostAssets.length}
                    </span>
                  </div>

                  {clearance.currentlyAssigned.length > 0 && (
                    <div className="space-y-2">
                      {clearance.currentlyAssigned.map((asg) => (
                        <div
                          key={asg.id}
                          className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 flex flex-wrap items-center justify-between gap-2"
                        >
                          <div>
                            <span className="font-mono font-bold">{asg.assetTag}</span> ·{' '}
                            <span className="font-semibold">{asg.assetName}</span> ({asg.assetCategory}) · Assigned{' '}
                            <span className="font-mono">{asg.assignedDate}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => openReturnModalByAssignment(asg)}
                            className="min-h-[34px] px-3 py-1 rounded-lg bg-[#B5121B] hover:bg-[#960E16] text-white font-semibold inline-flex items-center gap-1"
                          >
                            <PackageCheck className="w-3.5 h-3.5" />
                            Process Return
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {clearance.lostAssets.length > 0 && (
                    <div className="space-y-2">
                      {clearance.lostAssets.map((lost) => (
                        <div
                          key={lost.id}
                          className="p-3 rounded-xl border border-red-200 dark:border-red-900/70 bg-red-50/70 dark:bg-red-950/30 flex flex-wrap items-center justify-between gap-2 text-[#B5121B] dark:text-red-300"
                        >
                          <div>
                            <span className="font-mono font-bold">{lost.assetTag}</span> ·{' '}
                            <span className="font-semibold">{lost.name}</span> ({lost.category}) —{' '}
                            <span className="font-semibold">Marked Missing / Lost</span>
                          </div>
                          <span className="text-[11px] font-mono">Clearance Hold</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {clearance.returned.length > 0 && (
                    <div className="text-[11px] text-zinc-500">
                      Returned history: {clearance.returned.map((r) => `${r.assetTag} (${r.returnDate})`).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Register / Edit Asset Modal */}
      {assetModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveAsset}
            className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl max-h-[92vh] flex flex-col"
          >
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="text-base font-semibold">
                {editingAsset ? `Edit Asset · ${editingAsset.assetTag}` : 'Register New Company Asset'}
              </h3>
              <button type="button" onClick={() => setAssetModalOpen(false)} className="text-zinc-500 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto text-xs">
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium mb-1">Company *</label>
                  <select
                    disabled={!isSuperAdmin || Boolean(editingAsset)}
                    value={assetForm.companyId}
                    onChange={(e) => {
                      const nextCo = e.target.value as CompanyId;
                      setAssetForm({
                        ...assetForm,
                        companyId: nextCo,
                        currency: nextCo === 'mygrade' ? 'INR' : assetForm.currency,
                      });
                    }}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 disabled:opacity-75 font-medium"
                  >
                    <option value="talentgrade">TalentGrade</option>
                    <option value="mygrade">MyGrade (INR only)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">Asset ID / Tag *</label>
                  <input
                    required
                    maxLength={60}
                    value={assetForm.assetTag}
                    onChange={(e) => setAssetForm({ ...assetForm, assetTag: e.target.value.toUpperCase() })}
                    placeholder="AST-001"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Category *</label>
                  <select
                    value={assetForm.category}
                    onChange={(e) => setAssetForm({ ...assetForm, category: e.target.value as AssetCategory })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  >
                    {ASSET_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-medium mb-1">Asset Name *</label>
                  <input
                    required
                    maxLength={120}
                    value={assetForm.name}
                    onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
                    placeholder="e.g. MacBook Pro 14 M3"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Serial Number</label>
                  <input
                    maxLength={100}
                    value={assetForm.serialNumber}
                    onChange={(e) => setAssetForm({ ...assetForm, serialNumber: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Brand</label>
                  <input
                    maxLength={80}
                    value={assetForm.brand}
                    onChange={(e) => setAssetForm({ ...assetForm, brand: e.target.value })}
                    placeholder="Apple / Dell / Lenovo"
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Model</label>
                  <input
                    maxLength={80}
                    value={assetForm.model}
                    onChange={(e) => setAssetForm({ ...assetForm, model: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-medium mb-1">Purchase Date</label>
                  <input
                    type="date"
                    value={assetForm.purchaseDate}
                    onChange={(e) => setAssetForm({ ...assetForm, purchaseDate: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Purchase Cost</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={assetForm.purchaseCost}
                    onChange={(e) => setAssetForm({ ...assetForm, purchaseCost: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Currency</label>
                  <select
                    disabled={assetForm.companyId === 'mygrade'}
                    value={assetForm.companyId === 'mygrade' ? 'INR' : assetForm.currency}
                    onChange={(e) => setAssetForm({ ...assetForm, currency: e.target.value as SupportedCurrency })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono disabled:opacity-75"
                  >
                    <option value="INR">INR (₹)</option>
                    {assetForm.companyId !== 'mygrade' && <option value="AED">AED (د.إ)</option>}
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">Warranty Expiry</label>
                  <input
                    type="date"
                    value={assetForm.warrantyExpiry}
                    onChange={(e) => setAssetForm({ ...assetForm, warrantyExpiry: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Condition *</label>
                  <select
                    value={assetForm.condition}
                    onChange={(e) => setAssetForm({ ...assetForm, condition: e.target.value as AssetCondition })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  >
                    {ASSET_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium mb-1">Status *</label>
                  <select
                    disabled={Boolean(editingAsset?.currentAssignmentId)}
                    value={assetForm.status}
                    onChange={(e) => setAssetForm({ ...assetForm, status: e.target.value as AssetStatus })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 disabled:opacity-75"
                  >
                    {(editingAsset?.currentAssignmentId
                      ? ASSET_STATUSES
                      : ASSET_STATUSES.filter((s) => s !== 'Assigned')
                    ).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {editingAsset?.currentAssignmentId && (
                    <span className="text-[10px] text-zinc-500">Use the Return button to change an Assigned asset&apos;s status.</span>
                  )}
                </div>
              </div>

              <div>
                <label className="block font-medium mb-1">Notes</label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={assetForm.notes}
                  onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })}
                  className="w-full py-2 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                />
              </div>

              <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60">
                <AttachmentUploadField
                  ownerUid={employee.uid}
                  assetType="asset_photo"
                  label="Asset Photo (Optional)"
                  value={assetPhoto}
                  onChange={setAssetPhoto}
                  onError={(msg) => showToast(msg, 'error')}
                />
              </div>
            </div>

            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex gap-3">
              <button
                type="button"
                onClick={() => setAssetModalOpen(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingAsset}
                className="flex-1 min-h-[44px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold disabled:opacity-50"
              >
                {savingAsset ? 'Saving...' : editingAsset ? 'Save Asset' : 'Register Asset'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Assign Asset Modal */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleAssignSubmit}
            className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl"
          >
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">Assign Asset · {assignTarget.assetTag}</h3>
                <p className="text-[11px] text-zinc-500">{assignTarget.name}</p>
              </div>
              <button type="button" onClick={() => setAssignTarget(null)} className="text-zinc-500 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div>
                <label className="block font-medium mb-1">
                  Assign to Employee ({getCompanyShortName(assignTarget.companyId)}) *
                </label>
                <select
                  required
                  value={assignForm.employeeId}
                  onChange={(e) => setAssignForm({ ...assignForm, employeeId: e.target.value })}
                  className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                >
                  <option value="">Select active employee...</option>
                  {employees
                    .filter(
                      (emp) =>
                        emp.status === 'Active' &&
                        normalizeCompanyId(emp.companyId) === assignTarget.companyId
                    )
                    .map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName} ({emp.employeeCode}) · {emp.department}
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Assigned Date *</label>
                  <input
                    type="date"
                    required
                    value={assignForm.assignedDate}
                    onChange={(e) => setAssignForm({ ...assignForm, assignedDate: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Condition on Assign *</label>
                  <select
                    value={assignForm.conditionOnAssign}
                    onChange={(e) =>
                      setAssignForm({ ...assignForm, conditionOnAssign: e.target.value as AssetCondition })
                    }
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  >
                    {ASSET_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium mb-1">Handover Remarks (Optional)</label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={assignForm.assignRemarks}
                  onChange={(e) => setAssignForm({ ...assignForm, assignRemarks: e.target.value })}
                  placeholder="Included accessories (charger, bag, dongle)..."
                  className="w-full py-2 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                />
              </div>
            </div>
            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex gap-3">
              <button
                type="button"
                onClick={() => setAssignTarget(null)}
                className="flex-1 min-h-[42px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={assigning || !assignForm.employeeId}
                className="flex-1 min-h-[42px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold disabled:opacity-50"
              >
                {assigning ? 'Assigning...' : 'Confirm Assignment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Return Asset Modal */}
      {returnTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleReturnSubmit}
            className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl"
          >
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">Process Asset Return · {returnTarget.assetTag}</h3>
                <p className="text-[11px] text-zinc-500">
                  Assigned to {returnTarget.employeeName} ({returnTarget.employeeCode})
                </p>
              </div>
              <button type="button" onClick={() => setReturnTarget(null)} className="text-zinc-500 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium mb-1">Return Date *</label>
                  <input
                    type="date"
                    required
                    value={returnForm.returnDate}
                    onChange={(e) => setReturnForm({ ...returnForm, returnDate: e.target.value })}
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Condition on Return *</label>
                  <select
                    value={returnForm.returnCondition}
                    onChange={(e) =>
                      setReturnForm({ ...returnForm, returnCondition: e.target.value as AssetCondition })
                    }
                    className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  >
                    {ASSET_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium mb-1">Resulting Asset Inventory Status *</label>
                <select
                  value={returnForm.nextAssetStatus}
                  onChange={(e) =>
                    setReturnForm({
                      ...returnForm,
                      nextAssetStatus: e.target.value as Exclude<AssetStatus, 'Assigned'>,
                    })
                  }
                  className="w-full min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                >
                  <option value="Available">Available (Ready for re-assignment)</option>
                  <option value="Under repair">Under repair</option>
                  <option value="Lost">Lost</option>
                  <option value="Retired">Retired</option>
                </select>
              </div>

              <div>
                <label className="block font-medium mb-1">Return Remarks</label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={returnForm.returnRemarks}
                  onChange={(e) => setReturnForm({ ...returnForm, returnRemarks: e.target.value })}
                  placeholder="Inspection notes, missing charger, damage notes..."
                  className="w-full py-2 px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                />
              </div>
            </div>
            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex gap-3">
              <button
                type="button"
                onClick={() => setReturnTarget(null)}
                className="flex-1 min-h-[42px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={returning}
                className="flex-1 min-h-[42px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold disabled:opacity-50"
              >
                {returning ? 'Recording Return...' : 'Confirm Return'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Employee Digital Custody Confirmation Modal */}
      {ackTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmAcknowledgment}
            className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl"
          >
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="text-base font-semibold">Confirm Asset Receipt</h3>
              <button type="button" onClick={() => setAckTarget(null)} className="text-zinc-500 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-1.5">
                <div className="font-mono font-bold text-[#B5121B]">{ackTarget.assetTag}</div>
                <div className="font-semibold text-sm">{ackTarget.assetName}</div>
                <div className="text-zinc-500">
                  Category: {ackTarget.assetCategory} · Serial: {ackTarget.serialNumber || '—'}
                </div>
                <div className="text-zinc-500">
                  Condition: {ackTarget.conditionOnAssign} · Assigned: {ackTarget.assignedDate}
                </div>
                {ackTarget.assignRemarks && (
                  <div className="text-zinc-600 dark:text-zinc-300 pt-1">Remarks: {ackTarget.assignRemarks}</div>
                )}
              </div>

              <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-400">
                {ASSET_ACKNOWLEDGMENT_NOTICE}
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ackChecked}
                  onChange={(e) => setAckChecked(e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-[#B5121B]"
                />
                <span>
                  I confirm that I have received the above company asset in{' '}
                  <span className="font-semibold">{ackTarget.conditionOnAssign}</span> condition and accept responsibility for its safekeeping until returned.
                </span>
              </label>
            </div>
            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex gap-3">
              <button
                type="button"
                onClick={() => setAckTarget(null)}
                className="flex-1 min-h-[42px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={acknowledging || !ackChecked}
                className="flex-1 min-h-[42px] rounded-xl bg-[#B5121B] hover:bg-[#960E16] text-white text-xs font-semibold disabled:opacity-50"
              >
                {acknowledging ? 'Confirming...' : 'Confirm Receipt'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Asset Assignment History Modal */}
      {historyAsset && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-2xl max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">
                  Custody History · {historyAsset.assetTag}
                </h3>
                <p className="text-xs text-zinc-500">{historyAsset.name}</p>
              </div>
              <button type="button" onClick={() => setHistoryAsset(null)} className="text-zinc-500 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3 text-xs">
              {assignments.filter((a) => a.assetId === historyAsset.id).length === 0 ? (
                <p className="text-zinc-500 text-center py-6">This asset has not been assigned yet.</p>
              ) : (
                assignments
                  .filter((a) => a.assetId === historyAsset.id)
                  .map((a) => (
                    <div
                      key={a.id}
                      className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          {a.employeeName} ({a.employeeCode})
                        </span>
                        <span className="font-mono text-[11px] text-zinc-500">
                          Assigned {a.assignedDate}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        Condition: {a.conditionOnAssign} · Assigned by {a.assignedByName}
                      </div>
                      <div className="text-[11px]">
                        Custody Confirmation:{' '}
                        {a.acknowledged ? (
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            Confirmed {a.acknowledgedAtIso?.slice(0, 10)}
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">Pending</span>
                        )}
                      </div>
                      <div className="text-[11px]">
                        Return:{' '}
                        {a.returned ? (
                          <span className="font-mono">
                            Returned {a.returnDate} ({a.returnCondition}) · Processed by {a.returnedByAdminName}
                          </span>
                        ) : (
                          <span className="text-sky-700 dark:text-sky-400 font-medium">Currently Assigned</span>
                        )}
                      </div>
                      {(a.assignRemarks || a.returnRemarks) && (
                        <div className="text-[11px] text-zinc-500 pt-1">
                          {a.assignRemarks && <div>Assign note: {a.assignRemarks}</div>}
                          {a.returnRemarks && <div>Return note: {a.returnRemarks}</div>}
                        </div>
                      )}
                    </div>
                  ))
              )}
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
