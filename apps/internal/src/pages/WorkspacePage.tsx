import { Link, useNavigate } from "react-router-dom";
import type { WorkspaceDto } from "@bravos/contracts";
import { signOut } from "../api.ts";

export function WorkspacePage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
  const navigate = useNavigate();

  async function logout() {
    await signOut();
    onChanged(null);
    navigate("/login");
  }

  return (
    <main className="shell">
      <header className="brand">
        <div>
          <h1>مساحة العمل</h1>
          <p className="muted">{workspace.staff.displayName}</p>
        </div>
        <div className="actions">
          <Link className="button secondary" to="/select-branch">تغيير الفرع</Link>
          {workspace.capabilities.manageStaff ? (
            <Link className="button secondary" to="/staff">الموظفون</Link>
          ) : null}
          <button className="secondary" type="button" onClick={() => void logout()}>
            تسجيل الخروج
          </button>
        </div>
      </header>
      <div className="branch-banner" data-testid="active-branch">
        الفرع النشط: {workspace.activeBranch?.nameAr}
      </div>
      <section className="card">
        <h2>ما المتاح الآن</h2>
        <p>
          يمكنك تسجيل الدخول، اختيار فرع مصرّح به، وإدارة حسابات الموظفين إذا كنت مديراً.
          المبيعات والمخزون والطلبات لم تُنفَّذ بعد في هذا الإصدار.
        </p>
      </section>
    </main>
  );
}
