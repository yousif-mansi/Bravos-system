import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import type { WorkspaceDto } from "@bravos/contracts";
import { ApiError, getWorkspace, signIn } from "../api.ts";
import { brandAssets } from "../brand.ts";

export function LoginPage({
  onSignedIn,
}: {
  onSignedIn: (workspace: WorkspaceDto) => void | Promise<void>;
}) {
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
      await onSignedIn(workspace);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تسجيل الدخول.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-screen" data-theme="dark">
      <div className="login-cover" style={{ backgroundImage: `url(${brandAssets.cover})` }} />
      <section className="login-panel">
        <img
          className="login-logo"
          src={brandAssets.primaryIvory}
          alt="برافوس"
          width={180}
          height={225}
        />
        <h1>تسجيل الدخول</h1>
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
              {pending ? "لحظات…" : "دخول"}
            </button>
            <Link className="button ghost" to="/recovery">
              استرداد حساب المالك
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
