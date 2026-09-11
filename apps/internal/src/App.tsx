import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { WorkspaceDto } from "@bravos/contracts";
import { ApiError, getWorkspace } from "./api.ts";
import { LoginPage } from "./pages/LoginPage.tsx";
import { RecoveryPage } from "./pages/RecoveryPage.tsx";
import { BranchPage } from "./pages/BranchPage.tsx";
import { WorkspacePage } from "./pages/WorkspacePage.tsx";

const StaffPage = lazy(() => import("./pages/StaffPage.tsx"));
const CatalogPage = lazy(() => import("./pages/CatalogPage.tsx"));
const LookupPage = lazy(() => import("./pages/LookupPage.tsx"));
const ReceivingPage = lazy(() => import("./pages/ReceivingPage.tsx"));

export function App() {
  const location = useLocation();
  const [workspace, setWorkspace] = useState<WorkspaceDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getWorkspace()
      .then((value) => {
        if (cancelled) {
          return;
        }
        setError("");
        setWorkspace(value);
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }
        if (caught instanceof ApiError && caught.status === 401) {
          setWorkspace(null);
          setError("");
          return;
        }
        setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل مساحة العمل.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  function replaceWorkspace(next: WorkspaceDto | null) {
    setError("");
    setWorkspace(next);
  }

  if (loading) {
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
        <Route path="/login" element={<LoginPage onSignedIn={replaceWorkspace} />} />
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
        <Route path="*" element={<Navigate to={workspace ? "/workspace" : "/login"} replace />} />
      </Routes>
    </>
  );
}
