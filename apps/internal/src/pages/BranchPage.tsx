import type { WorkspaceDto } from "@bravos/contracts";
import { ApiError, selectBranch } from "../api.ts";
import { signOutPreservingSales } from "../session.ts";
import { useState } from "react";
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

  async function choose(branchId: string) {
    setError("");
    try {
      const next = await selectBranch(branchId);
      await onChanged(next);
      navigate("/workspace");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر اختيار الفرع.");
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
    <main className="shell">
      <header className="brand">
        <div>
          <h1>اختيار الفرع النشط</h1>
          <p className="muted">{workspace.staff.displayName}</p>
        </div>
        <button className="secondary" type="button" onClick={() => void logout()}>
          تسجيل الخروج
        </button>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {workspace.authorizedBranches.length === 0 ? (
        <div className="empty">لا توجد فروع مصرّح بها لهذا الحساب.</div>
      ) : (
        <section className="card">
          <p>اختر الفرع الذي ستعمل منه الآن. المبيعات والمصروفات ستُنسب إلى هذا الفرع لاحقاً.</p>
          <div className="actions">
            {workspace.authorizedBranches.map((branch) => (
              <button key={branch.id} type="button" onClick={() => void choose(branch.id)}>
                {branch.nameAr}
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
