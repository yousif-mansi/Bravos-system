import type { WorkspaceDto } from "@bravos/contracts";
import { ApiError, selectBranch } from "../api.ts";
import { signOutPreservingSales } from "../session.ts";
import { useEffect, useRef, useState } from "react";
import { accountGeneration, subscribeAccount } from "../account-session.ts";
import { useNavigate } from "react-router-dom";

export function BranchPage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pendingBranch, setPendingBranch] = useState<string | null>(null);
  const choosingRef = useRef(false);
  const lifecycle = useRef(0);
  useEffect(() => {
    const unsubscribe = subscribeAccount((account) => {
      if (account.staffId !== workspace.staff.id) lifecycle.current += 1;
    });
    return () => { lifecycle.current += 1; unsubscribe(); };
  }, [workspace.staff.id]);

  async function choose(branchId: string) {
    if (choosingRef.current) return;
    choosingRef.current = true;
    const token = lifecycle.current;
    const epoch = accountGeneration();
    const stillCurrent = () => lifecycle.current === token && accountGeneration() === epoch;
    setPendingBranch(branchId);
    setError("");
    try {
      const next = await selectBranch(branchId);
      if (!stillCurrent()) return;
      await onChanged(next);
      if (lifecycle.current !== token) return;
      navigate("/workspace");
    } catch (caught) {
      if (lifecycle.current === token) setError(caught instanceof ApiError ? caught.messageAr : "تعذر اختيار الفرع.");
    } finally {
      if (lifecycle.current === token) { choosingRef.current = false; setPendingBranch(null); }
    }
  }

  async function logout() {
    const accepted = await signOutPreservingSales(workspace.staff.id);
    if (!accepted) {
      return;
    }
    await onChanged(null);
  }

  return (
    <main className="auth-screen">
      <section className="card auth-card">
      <header className="page-hero">
        <div>
          <h1>اختيار الفرع النشط</h1>
          <p className="muted">{workspace.staff.displayName}</p>
        </div>
        <button className="ghost" type="button" disabled={pendingBranch !== null} onClick={() => void logout()}>
          تسجيل الخروج
        </button>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {workspace.authorizedBranches.length === 0 ? (
        <div className="empty">لا توجد فروع مصرّح بها لهذا الحساب.</div>
      ) : (
        <>
          <p>اختَر الفرع اللي هتشتغل منه دلوقتي.</p>
          <div className="actions">
            {workspace.authorizedBranches.map((branch) => (
              <button key={branch.id} type="button" disabled={pendingBranch !== null} onClick={() => void choose(branch.id)}>
                {pendingBranch === branch.id ? `جارٍ اختيار ${branch.nameAr}…` : branch.nameAr}
              </button>
            ))}
          </div>
        </>
      )}
      </section>
    </main>
  );
}
