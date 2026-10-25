import { type FormEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, completeOwnerRecovery, requestOwnerRecovery } from "../api.ts";

export function RecoveryPage() {
  const [loginName, setLoginName] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"request" | "complete" | null>(null);
  const pendingRef = useRef(false);

  async function runRecovery(kind: "request" | "complete", work: () => Promise<unknown>, success: string, failure: string) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(kind);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : failure);
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }

  function requestToken(event: FormEvent) {
    event.preventDefault();
    void runRecovery(
      "request",
      () => requestOwnerRecovery(loginName),
      "إذا كان الحساب مالكاً، سيصل رمز الاسترداد عبر وسيلة الاسترداد المعتمدة.",
      "تعذر طلب الاسترداد.",
    );
  }

  function complete(event: FormEvent) {
    event.preventDefault();
    void runRecovery(
      "complete",
      () => completeOwnerRecovery(token, password),
      "تم تعيين كلمة المرور الجديدة. يمكنك تسجيل الدخول الآن.",
      "تعذر إكمال الاسترداد.",
    );
  }

  return (
    <main className="shell">
      <header className="page-hero">
        <h1>استرداد حساب المالك</h1>
        <Link className="button ghost" to="/login">العودة لتسجيل الدخول</Link>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <p className="notice" role="status">{message}</p> : null}
      <div className="grid two">
        <form className="card" aria-busy={pending === "request"} onSubmit={requestToken}>
          <fieldset disabled={pending !== null}>
            <h2>طلب الرمز</h2>
            <div className="field">
              <label htmlFor="ownerLogin">اسم دخول المالك</label>
              <input id="ownerLogin" value={loginName} onChange={(event) => setLoginName(event.target.value)} required />
            </div>
            <div className="form-actions">
              <button type="submit" disabled={pending !== null}>{pending === "request" ? "جارٍ طلب الاسترداد…" : "طلب الاسترداد"}</button>
            </div>
          </fieldset>
        </form>
        <form className="card" aria-busy={pending === "complete"} onSubmit={complete}>
          <fieldset disabled={pending !== null}>
            <h2>تعيين كلمة مرور جديدة</h2>
            <div className="field">
              <label htmlFor="token">رمز الاسترداد</label>
              <input id="token" value={token} onChange={(event) => setToken(event.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="newPassword">كلمة المرور الجديدة</label>
              <input id="newPassword" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </div>
            <button type="submit" disabled={pending !== null}>{pending === "complete" ? "جارٍ الحفظ…" : "حفظ"}</button>
          </fieldset>
        </form>
      </div>
    </main>
  );
}
