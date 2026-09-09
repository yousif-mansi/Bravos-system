import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, completeOwnerRecovery, requestOwnerRecovery } from "../api.ts";

export function RecoveryPage() {
  const [loginName, setLoginName] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function requestToken(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await requestOwnerRecovery(loginName);
      setMessage("إذا كان الحساب مالكاً، سيصل رمز الاسترداد عبر وسيلة الاسترداد المعتمدة.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر طلب الاسترداد.");
    }
  }

  async function complete(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await completeOwnerRecovery(token, password);
      setMessage("تم تعيين كلمة المرور الجديدة. يمكنك تسجيل الدخول الآن.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر إكمال الاسترداد.");
    }
  }

  return (
    <main className="shell">
      <header className="brand">
        <h1>استرداد حساب المالك</h1>
        <Link className="button secondary" to="/login">العودة لتسجيل الدخول</Link>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <p className="muted">{message}</p> : null}
      <div className="grid two">
        <form className="card" onSubmit={requestToken}>
          <h2>طلب الرمز</h2>
          <div className="field">
            <label htmlFor="ownerLogin">اسم دخول المالك</label>
            <input id="ownerLogin" value={loginName} onChange={(event) => setLoginName(event.target.value)} required />
          </div>
          <button type="submit">طلب الاسترداد</button>
        </form>
        <form className="card" onSubmit={complete}>
          <h2>تعيين كلمة مرور جديدة</h2>
          <div className="field">
            <label htmlFor="token">رمز الاسترداد</label>
            <input id="token" value={token} onChange={(event) => setToken(event.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="newPassword">كلمة المرور الجديدة</label>
            <input id="newPassword" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          <button type="submit">حفظ</button>
        </form>
      </div>
    </main>
  );
}
