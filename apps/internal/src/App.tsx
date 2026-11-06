import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { WorkspaceDto } from "@bravos/contracts";
import { acceptOfflineSale, ApiError, completeSale, getWorkspace } from "./api.ts";
import { AppShell } from "./layout/AppShell.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { RecoveryPage } from "./pages/RecoveryPage.tsx";
import { BranchPage } from "./pages/BranchPage.tsx";
import { WorkspacePage } from "./pages/WorkspacePage.tsx";
import { accountGeneration, publishAccount, subscribeAccount } from "./account-session.ts";
import {
  acceptedPayload,
  cacheIssuedSnapshot,
  completedPayload,
  issueStaffPosSnapshot,
  pos,
  prepareOfflineWorkspace,
  retryUnsyncedSales,
} from "./pos.ts";
import { isNetworkFailure } from "./session.ts";

const StaffPage = lazy(() => import("./pages/StaffPage.tsx"));
const CatalogPage = lazy(() => import("./pages/CatalogPage.tsx"));
const LookupPage = lazy(() => import("./pages/LookupPage.tsx"));
const ReceivingPage = lazy(() => import("./pages/ReceivingPage.tsx"));
const SuppliersPage = lazy(() => import("./pages/SuppliersPage.tsx"));
const CustomersPage = lazy(() => import("./pages/CustomersPage.tsx"));
const SalesPage = lazy(() => import("./pages/SalesPage.tsx"));
const ExpensesPage = lazy(() => import("./pages/ExpensesPage.tsx"));
const OffersPage = lazy(() => import("./pages/OffersPage.tsx"));
const ReturnsPage = lazy(() => import("./pages/ReturnsPage.tsx"));
const CorrectionsPage = lazy(() => import("./pages/CorrectionsPage.tsx"));
const StockCorrectionsPage = lazy(() => import("./pages/StockCorrectionsPage.tsx"));
const StorefrontSettingsPage = lazy(() => import("./pages/StorefrontSettingsPage.tsx"));
const DeliveryAreasPage = lazy(() => import("./pages/DeliveryAreasPage.tsx"));
const OnlineOrdersPage = lazy(() => import("./pages/OnlineOrdersPage.tsx"));
const OpeningImportPage = lazy(() => import("./pages/OpeningImportPage.tsx"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage.tsx"));
const ReportsPage = lazy(() => import("./pages/ReportsPage.tsx"));
const BackupPage = lazy(() => import("./pages/BackupPage.tsx"));
const RestorePage = lazy(() => import("./pages/RestorePage.tsx"));

export function App() {
  const location = useLocation();
  const [workspaceGeneration, setWorkspaceGeneration] = useState(accountGeneration);
  const [workspace, setWorkspace] = useState<WorkspaceDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const staffIdRef = useRef<string | null>(null);
  const signedOutRef = useRef(false);

  useEffect(() => {
    if (signedOutRef.current) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const epoch = accountGeneration();
    const stillCurrent = () => !cancelled && accountGeneration() === epoch && !signedOutRef.current;
    const persistRevision = crypto.randomUUID();
    void (async () => {
      let expectedRevision: string | null = null;
      try {
        expectedRevision = await pos.readSessionRevision();
      } catch {
        if (stillCurrent()) {
          setError("تعذر تحميل مساحة العمل.");
          setLoading(false);
        }
        return;
      }
      if (!stillCurrent()) {
        return;
      }
      try {
        const value = await getWorkspace();
        if (!stillCurrent()) {
          return;
        }
        if (signedOutRef.current) {
          staffIdRef.current = null;
          setWorkspace(null);
          setError("");
          return;
        }
        setError("");
        const accepted = await prepareOfflineWorkspace(value, {
          expectedRevision,
          revision: persistRevision,
        });
        if (!stillCurrent()) {
          return;
        }
        if (!accepted) {
          const cached = await pos.loadSignedInWorkspace();
          if (cached && stillCurrent()) {
            staffIdRef.current = cached.staff.id;
            setWorkspace(cached);
            return;
          }
          setError("تعذر تجهيز مساحة العمل.");
          return;
        }
        staffIdRef.current = value.staff.id;
        setWorkspace(value);
      } catch (caught: unknown) {
        if (!stillCurrent()) {
          return;
        }
        if (caught instanceof ApiError && caught.status === 401) {
          staffIdRef.current = null;
          setWorkspace(null);
          setError("");
          return;
        }
        if (isNetworkFailure(caught)) {
          const cached = await pos.loadSignedInWorkspace();
          if (!stillCurrent()) {
            return;
          }
          if (cached) {
            staffIdRef.current = cached.staff.id;
            setError("");
            setWorkspace(cached);
            return;
          }
        }
        setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل مساحة العمل.");
      } finally {
        if (stillCurrent()) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  useEffect(() => {
    return subscribeAccount((payload) => {
      setWorkspaceGeneration(payload.generation);
      if (payload.staffId === staffIdRef.current) {
        return;
      }
      const epoch = payload.generation;
      const stillCurrent = () => accountGeneration() === epoch;
      if (!payload.staffId) {
        signedOutRef.current = true;
        staffIdRef.current = null;
        setWorkspace(null);
        setError("");
        setLoading(false);
        return;
      }
      signedOutRef.current = false;
      const persistRevision = crypto.randomUUID();
      void (async () => {
        let expectedRevision: string | null = null;
        try {
          expectedRevision = await pos.readSessionRevision();
        } catch {
          return;
        }
        if (!stillCurrent()) {
          return;
        }
        try {
          const value = await getWorkspace();
          if (!stillCurrent() || signedOutRef.current) {
            return;
          }
          setError("");
          const accepted = await prepareOfflineWorkspace(value, {
            expectedRevision,
            revision: persistRevision,
          });
          if (!stillCurrent()) {
            return;
          }
          if (!accepted) {
            const cached = await pos.loadSignedInWorkspace();
            if (cached && stillCurrent()) {
              staffIdRef.current = cached.staff.id;
              setWorkspace(cached);
            } else if (stillCurrent()) {
              setError("تعذر تجهيز مساحة العمل.");
            }
            return;
          }
          staffIdRef.current = value.staff.id;
          setWorkspace(value);
        } catch (caught: unknown) {
          if (!stillCurrent()) {
            return;
          }
          if (isNetworkFailure(caught)) {
            const cached = await pos.loadSignedInWorkspace();
            if (!stillCurrent()) {
              return;
            }
            if (cached) {
              staffIdRef.current = cached.staff.id;
              setWorkspace(cached);
              setError("");
              return;
            }
          }
          staffIdRef.current = null;
          setWorkspace(null);
        }
      })();
    });
  }, []);

  useEffect(() => {
    if (!workspace?.capabilities.cashier) {
      return;
    }
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const stillCurrent = () => accountGeneration() === epoch && staffIdRef.current === staffId;
    let stopped = false;
    let syncing = false;
    let retryTimer: number | undefined;
    let retryDelayMs = 2_000;
    const sync = {
      accept: async (sale: Parameters<typeof acceptedPayload>[0]) => {
        if (!stillCurrent() || sale.staffId !== staffId) {
          return Promise.reject(new Error("stale-account"));
        }
        return acceptOfflineSale(await acceptedPayload(sale));
      },
      complete: async (sale: Parameters<typeof completedPayload>[0]) => {
        if (!stillCurrent() || sale.staffId !== staffId) {
          return Promise.reject(new Error("stale-account"));
        }
        return completeSale(await completedPayload(sale));
      },
    };
    function scheduleRetry() {
      window.clearTimeout(retryTimer);
      if (!stopped && stillCurrent()) retryTimer = window.setTimeout(() => void syncNow(), retryDelayMs);
    }
    async function syncNow() {
      if (stopped || syncing || !stillCurrent()) return;
      syncing = true;
      try {
          if ((await pos.listUnsynced(staffId)).length === 0) {
            retryDelayMs = 30_000;
            return;
          }
          const value = await getWorkspace();
          if (!stillCurrent()) {
            return;
          }
          if (value.staff.id !== staffId) {
            return;
          }
          setWorkspace((current) => current && JSON.stringify(current) === JSON.stringify(value) ? current : value);
          if (!value.capabilities.cashier) {
            return;
          }
          const result = await retryUnsyncedSales(staffId, sync, stillCurrent);
          if (stillCurrent() && result.error) {
            setError(`${result.error} البيع المكتمل محفوظ محلياً وسيظل ضمن المبيعات غير المرسلة.`);
            retryDelayMs = Math.min(Math.max(2_000, retryDelayMs * 2), 30_000);
          } else if (stillCurrent()) {
            retryDelayMs = result.remaining > 0 ? 2_000 : 30_000;
            const snapshot = await issueStaffPosSnapshot(await pos.listPendingOperationIds(), "passive");
            if (stillCurrent()) {
              await cacheIssuedSnapshot(staffId, snapshot);
            }
          }
        } catch (caught: unknown) {
          if (!stillCurrent()) {
            return;
          }
          if (caught instanceof ApiError && caught.status === 401) {
            staffIdRef.current = null;
            setWorkspace(null);
          }
          retryDelayMs = Math.min(Math.max(2_000, retryDelayMs * 2), 30_000);
        } finally {
          syncing = false;
          scheduleRetry();
        }
    }
    function onOnline() {
      retryDelayMs = 2_000;
      void syncNow();
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onOnline);
    scheduleRetry();
    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onOnline);
    };
  }, [workspace?.staff.id, workspace?.capabilities.cashier, workspace?.activeBranch?.id, workspaceGeneration]);

  async function replaceWorkspace(next: WorkspaceDto | null) {
    setError("");
    if (!next) {
      signedOutRef.current = true;
      staffIdRef.current = null;
      setWorkspace(null);
      publishAccount(null);
      setLoading(false);
      return;
    }
    const showLoading = !workspace;
    if (showLoading) {
      setLoading(true);
    }
    const prepared = next;
    signedOutRef.current = false;
    staffIdRef.current = prepared.staff.id;
    const published = publishAccount(prepared.staff.id);
    const originatingGeneration = published.generation;
    const stillThisTransition = () => accountGeneration() === originatingGeneration;
    async function persistIfCurrent(expectedRevision: string | null, revision: string) {
      if (!stillThisTransition()) {
        return false;
      }
      const accepted = await prepareOfflineWorkspace(prepared, { expectedRevision, revision });
      return stillThisTransition() && accepted;
    }
    try {
      let expectedRevision = await pos.readSessionRevision();
      let accepted = await persistIfCurrent(expectedRevision, published.revision);
      if (!accepted && stillThisTransition()) {
        expectedRevision = await pos.readSessionRevision();
        accepted = await persistIfCurrent(expectedRevision, crypto.randomUUID());
      }
      if (!stillThisTransition()) {
        return;
      }
      if (!accepted) {
        const cached = await pos.loadSignedInWorkspace();
        if (!stillThisTransition()) {
          return;
        }
        if (cached?.staff.id === prepared.staff.id) {
          setWorkspace(prepared);
          return;
        }
        setError("تعذر تجهيز مساحة العمل.");
        return;
      }
      setWorkspace(prepared);
    } catch (caught) {
      if (stillThisTransition()) {
        staffIdRef.current = null;
        setError("تعذر تجهيز مساحة العمل.");
      }
      throw caught;
    } finally {
      if (stillThisTransition()) {
        setLoading(false);
      }
    }
  }

  function guarded(node: ReactNode) {
    if (!workspace) return <Navigate to="/login" replace />;
    return (
      <AppShell workspace={workspace} onChanged={replaceWorkspace}>
        <Suspense fallback={<div className="page-loading" role="status">لحظات…</div>}>{node}</Suspense>
      </AppShell>
    );
  }

  if (loading && !workspace) {
    return (
      <main className="auth-screen">
        <p role="status">لحظات…</p>
      </main>
    );
  }

  return (
    <>
      {error && !workspace ? (
        <div className="auth-screen">
          <div className="error" role="alert">{error}</div>
        </div>
      ) : null}
      {error && workspace ? <div className="app-float-error" role="alert">{error}</div> : null}
      <Routes>
        <Route
          path="/login"
          element={
            workspace ? (
              <Navigate to={workspace.activeBranch ? "/workspace" : "/select-branch"} replace />
            ) : (
              <LoginPage onSignedIn={replaceWorkspace} />
            )
          }
        />
        <Route path="/recovery" element={<RecoveryPage />} />
        <Route
          path="/select-branch"
          element={
            workspace ? (
              <BranchPage workspace={workspace} onChanged={replaceWorkspace} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/workspace"
          element={
            workspace?.activeBranch ? (
              guarded(<WorkspacePage workspace={workspace} onChanged={replaceWorkspace} />)
            ) : workspace ? (
              <Navigate to="/select-branch" replace />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/staff"
          element={
            workspace?.capabilities.manageStaff ? (
              guarded(<StaffPage workspace={workspace} onChanged={replaceWorkspace} />)
            ) : (
              <Navigate to={workspace ? "/workspace" : "/login"} replace />
            )
          }
        />
        <Route
          path="/catalog"
          element={
            workspace?.capabilities.manageCatalog ? (
              guarded(<CatalogPage workspace={workspace} onChanged={replaceWorkspace} />)
            ) : (
              <Navigate to={workspace ? "/workspace" : "/login"} replace />
            )
          }
        />
        <Route
          path="/storefront-settings"
          element={
            workspace?.capabilities.manageCatalog ? (
              guarded(<StorefrontSettingsPage workspace={workspace} onChanged={replaceWorkspace} />)
            ) : (
              <Navigate to={workspace ? "/workspace" : "/login"} replace />
            )
          }
        />
        <Route
          path="/delivery-areas"
          element={
            workspace?.capabilities.manageCatalog ? (
              guarded(<DeliveryAreasPage workspace={workspace} />)
            ) : (
              <Navigate to={workspace ? "/workspace" : "/login"} replace />
            )
          }
        />
        <Route
          path="/lookup"
          element={
            workspace?.capabilities.cashier ? (
              guarded(<LookupPage workspace={workspace} onChanged={replaceWorkspace} />)
            ) : (
              <Navigate to={workspace ? "/workspace" : "/login"} replace />
            )
          }
        />
        <Route
          path="/receiving"
          element={
            workspace?.capabilities.manageInventory ? (
              guarded(<ReceivingPage workspace={workspace} onChanged={replaceWorkspace} />)
            ) : (
              <Navigate to={workspace ? "/workspace" : "/login"} replace />
            )
          }
        />
        <Route
          path="/transfers"
          element={
            workspace?.staff.role === "manager" && workspace.capabilities.manageInventory ? (
              <Navigate to="/receiving?tab=transfers" replace />
            ) : (
              <Navigate to={workspace ? "/workspace" : "/login"} replace />
            )
          }
        />
        <Route
          path="/suppliers"
          element={
            workspace?.staff.role === "manager" ? (
              guarded(<SuppliersPage workspace={workspace} onChanged={replaceWorkspace} />)
            ) : (
              <Navigate to={workspace ? "/workspace" : "/login"} replace />
            )
          }
        />
        <Route
          path="/customers"
          element={
            workspace?.staff.role === "manager" ? (
              guarded(<CustomersPage workspace={workspace} onChanged={replaceWorkspace} />)
            ) : (
              <Navigate to={workspace ? "/workspace" : "/login"} replace />
            )
          }
        />
        <Route
          path="/offers"
          element={
            workspace?.capabilities.managePricing ? (
              guarded(<OffersPage workspace={workspace} onChanged={replaceWorkspace} />)
            ) : (
              <Navigate to={workspace ? "/workspace" : "/login"} replace />
            )
          }
        />
        <Route
          path="/sales"
          element={
            workspace?.activeBranch ? (
              guarded(<SalesPage workspace={workspace} onChanged={replaceWorkspace} />)
            ) : (
              <Navigate to={workspace ? "/select-branch" : "/login"} replace />
            )
          }
        />
        <Route
          path="/expenses"
          element={
            workspace?.activeBranch ? (
              guarded(<ExpensesPage workspace={workspace} onChanged={replaceWorkspace} />)
            ) : (
              <Navigate to={workspace ? "/select-branch" : "/login"} replace />
            )
          }
        />
        <Route
          path="/returns"
          element={
            workspace?.activeBranch && workspace.staff.role === "manager" && workspace.capabilities.manageInventory ? (
              guarded(<ReturnsPage workspace={workspace} onChanged={replaceWorkspace} />)
            ) : (
              <Navigate to={workspace?.activeBranch ? "/workspace" : workspace ? "/select-branch" : "/login"} replace />
            )
          }
        />
        <Route
          path="/corrections"
          element={
            workspace?.activeBranch && workspace.staff.role === "manager" && workspace.capabilities.manageInventory ? (
              guarded(<CorrectionsPage workspace={workspace} onChanged={replaceWorkspace} />)
            ) : (
              <Navigate to={workspace?.activeBranch ? "/workspace" : workspace ? "/select-branch" : "/login"} replace />
            )
          }
        />
        <Route
          path="/stock-corrections"
          element={
            workspace?.activeBranch && workspace.staff.role === "manager" && workspace.capabilities.manageInventory ? (
              guarded(<StockCorrectionsPage workspace={workspace} />)
            ) : (
              <Navigate to={workspace?.activeBranch ? "/workspace" : workspace ? "/select-branch" : "/login"} replace />
            )
          }
        />
        <Route
          path="/online-orders/:orderId?"
          element={
            workspace && (workspace.staff.role === "manager" || workspace.capabilities.orderRepresentative) ? (
              guarded(<OnlineOrdersPage key={workspace.staff.id} workspace={workspace} />)
            ) : (
              <Navigate to={workspace?.activeBranch ? "/workspace" : workspace ? "/select-branch" : "/login"} replace />
            )
          }
        />
        <Route
          path="/opening-import"
          element={
            workspace?.staff.role === "manager"
              && workspace.capabilities.manageInventory
              && workspace.capabilities.manageCatalog ? (
                guarded(<OpeningImportPage key={workspace.staff.id} workspace={workspace} />)
              ) : (
                <Navigate to={workspace?.activeBranch ? "/workspace" : workspace ? "/select-branch" : "/login"} replace />
              )
          }
        />
        <Route
          path="/analytics"
          element={
            workspace?.staff.role === "manager" ? (
              guarded(<AnalyticsPage key={workspace.staff.id} workspace={workspace} />)
            ) : (
              <Navigate to={workspace?.activeBranch ? "/workspace" : workspace ? "/select-branch" : "/login"} replace />
            )
          }
        />
        <Route
          path="/reports"
          element={
            workspace?.staff.role === "manager" ? (
              guarded(<ReportsPage key={workspace.staff.id} workspace={workspace} />)
            ) : (
              <Navigate to={workspace?.activeBranch ? "/workspace" : workspace ? "/select-branch" : "/login"} replace />
            )
          }
        />
        <Route
          path="/backup"
          element={
            workspace?.staff.role === "manager" ? (
              guarded(<BackupPage key={workspace.staff.id} workspace={workspace} />)
            ) : (
              <Navigate to={workspace?.activeBranch ? "/workspace" : workspace ? "/select-branch" : "/login"} replace />
            )
          }
        />
        <Route
          path="/restore"
          element={
            workspace?.staff.role === "manager" ? (
              guarded(<RestorePage key={workspace.staff.id} workspace={workspace} onChanged={replaceWorkspace} />)
            ) : (
              <Navigate to={workspace?.activeBranch ? "/workspace" : workspace ? "/select-branch" : "/login"} replace />
            )
          }
        />
        <Route path="*" element={<Navigate to={workspace ? "/workspace" : "/login"} replace />} />
      </Routes>
    </>
  );
}
