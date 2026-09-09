import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { WorkspaceDto } from "@bravos/contracts";
import { ApiError, getWorkspace, signIn } from "../api.ts";

export function LoginPage({
  onSignedIn,
}: {
  onSignedIn: (workspace: WorkspaceDto) => void;
}) {
  const navigate = useNavigate();
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await signIn(loginName, password);
      const workspace = await getWorkspace();
      onSignedIn(workspace);
      navigate(workspace.activeBranch ? "/workspace" : "/select-branch");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تسجيل الدخول.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="shell">
      <header className="brand">
        <div>
          <h1>برافوس</h1>
          <p className="muted">دخول الموظفين إلى التطبيق الداخلي</p>
        </div>
      </header>
      <section className="card">
        <h2>تسجيل الدخول</h2>
        {error ? <div className="error" role="alert">{error}</div> : null}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="loginName">اسم الدخول</label>
            <input
              id="loginName"
              name="loginName"
              autoComplete="username"
              value={loginName}
              onChange={(event) => setLoginName(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">كلمة المرور</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <div className="actions">
            <button type="submit" disabled={pending}>
              {pending ? "جارٍ الدخول…" : "دخول"}
            </button>
            <Link className="button secondary" to="/recovery">
              استرداد حساب المالك
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
