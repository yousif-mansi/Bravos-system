import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { WorkspaceDto } from "@bravos/contracts";
import { acceptOfflineSale, ApiError, completeSale, getWorkspace } from "./api.ts";
import { LoginPage } from "./pages/LoginPage.tsx";
import { RecoveryPage } from "./pages/RecoveryPage.tsx";
import { BranchPage } from "./pages/BranchPage.tsx";
import { WorkspacePage } from "./pages/WorkspacePage.tsx";
import { accountGeneration, publishAccount, subscribeAccount } from "./account-session.ts";
import {
  acceptedPayload,
  completedPayload,
  pos,
  prepareOfflineWorkspace,
  retryUnsyncedSales,
} from "./pos.ts";
import { isNetworkFailure } from "./session.ts";

const StaffPage = lazy(() => import("./pages/StaffPage.tsx"));
const CatalogPage = lazy(() => import("./pages/CatalogPage.tsx"));
const LookupPage = lazy(() => import("./pages/LookupPage.tsx"));
const ReceivingPage = lazy(() => import("./pages/ReceivingPage.tsx"));
const SalesPage = lazy(() => import("./pages/SalesPage.tsx"));
const ExpensesPage = lazy(() => import("./pages/ExpensesPage.tsx"));

export function App() {
  const location = useLocation();
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
    function onOnline() {
      void (async () => {
        if (!stillCurrent()) {
          return;
        }
        try {
          const value = await getWorkspace();
          if (!stillCurrent()) {
            return;
          }
          if (value.staff.id !== staffId) {
            return;
          }
          setWorkspace(value);
          if (!value.capabilities.cashier) {
            return;
          }
          await retryUnsyncedSales(staffId, sync, stillCurrent);
        } catch (caught: unknown) {
          if (!stillCurrent()) {
            return;
          }
          if (caught instanceof ApiError && caught.status === 401) {
            staffIdRef.current = null;
            setWorkspace(null);
          }
        }
      })();
    }
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
    };
  }, [workspace?.staff.id, workspace?.capabilities.cashier]);

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

  if (loading && !workspace) {
    return (
      <main className="shell">
        <p>جارٍ التحميل…</p>
      </main>
    );
  }

  return (
    <>
      {error ? (
        <div className="shell">
          <div className="error" role="alert">{error}</div>
        </div>
      ) : null}
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
              <WorkspacePage workspace={workspace} onChanged={replaceWorkspace} />
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
              <Suspense fallback={<main className="shell">جارٍ التحميل…</main>}>
                <StaffPage workspace={workspace} onChanged={replaceWorkspace} />
              </Suspense>
            ) : (
              <Navigate to={workspace ? "/workspace" : "/login"} replace />
            )
          }
        />
        <Route
          path="/catalog"
          element={
            workspace?.capabilities.manageCatalog ? (
              <Suspense fallback={<main className="shell">جارٍ التحميل…</main>}>
                <CatalogPage workspace={workspace} onChanged={replaceWorkspace} />
              </Suspense>
            ) : (
              <Navigate to={workspace ? "/workspace" : "/login"} replace />
            )
          }
        />
        <Route
          path="/lookup"
          element={
            workspace?.capabilities.cashier ? (
              <Suspense fallback={<main className="shell">جارٍ التحميل…</main>}>
                <LookupPage workspace={workspace} onChanged={replaceWorkspace} />
              </Suspense>
            ) : (
              <Navigate to={workspace ? "/workspace" : "/login"} replace />
            )
          }
        />
        <Route
          path="/receiving"
          element={
            workspace?.capabilities.manageInventory ? (
              <Suspense fallback={<main className="shell">جارٍ التحميل…</main>}>
                <ReceivingPage workspace={workspace} onChanged={replaceWorkspace} />
              </Suspense>
            ) : (
              <Navigate to={workspace ? "/workspace" : "/login"} replace />
            )
          }
        />
        <Route
          path="/sales"
          element={
            workspace?.activeBranch ? (
              <Suspense fallback={<main className="shell">جارٍ التحميل…</main>}>
                <SalesPage workspace={workspace} onChanged={replaceWorkspace} />
              </Suspense>
            ) : (
              <Navigate to={workspace ? "/select-branch" : "/login"} replace />
            )
          }
        />
        <Route
          path="/expenses"
          element={
            workspace?.activeBranch ? (
              <Suspense fallback={<main className="shell">جارٍ التحميل…</main>}>
                <ExpensesPage workspace={workspace} onChanged={replaceWorkspace} />
              </Suspense>
            ) : (
              <Navigate to={workspace ? "/select-branch" : "/login"} replace />
            )
          }
        />
        <Route path="*" element={<Navigate to={workspace ? "/workspace" : "/login"} replace />} />
      </Routes>
    </>
  );
}
