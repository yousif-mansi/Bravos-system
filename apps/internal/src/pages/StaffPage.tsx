import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { BranchDto, StaffAccountDto, WorkspaceDto } from "@bravos/contracts";
import {
  ApiError,
  createStaff,
  disableStaff,
  listStaff,
  resetStaffPassword,
  setStaffGrants,
  signOut,
} from "../api.ts";

type GrantDraft = {
  assigned: boolean;
  cashier: boolean;
  orderRepresentative: boolean;
};

export default function StaffPage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
  const navigate = useNavigate();
  const branches = workspace.authorizedBranches;
  const [staff, setStaff] = useState<StaffAccountDto[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loginName, setLoginName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [createGrants, setCreateGrants] = useState<Record<string, GrantDraft>>(emptyDrafts(branches));
  const [pendingCreate, setPendingCreate] = useState(false);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [pendingAction, setPendingAction] = useState("");

  async function refresh() {
    setStaff(await listStaff());
  }

  useEffect(() => {
    void refresh().catch((caught: unknown) => {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل الموظفين.");
    });
  }, []);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setPendingCreate(true);
    try {
      await createStaff({
        loginName,
        displayName,
        password,
        grants: toGrantPayload(branches, createGrants),
      });
      setLoginName("");
      setDisplayName("");
      setPassword("");
      setCreateGrants(emptyDrafts(branches));
      setNotice("تم إنشاء الحساب.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر إنشاء الحساب.");
    } finally {
      setPendingCreate(false);
    }
  }

  async function logout() {
    await signOut();
    onChanged(null);
    navigate("/login");
  }

  return (
    <main className="shell">
      <header className="brand">
        <div>
          <h1>إدارة الموظفين</h1>
          <p className="muted">الفرع النشط: {workspace.activeBranch?.nameAr ?? "غير محدد"}</p>
        </div>
        <div className="actions">
          <Link className="button secondary" to="/workspace">العودة لمساحة العمل</Link>
          <button className="secondary" type="button" onClick={() => void logout()}>
            تسجيل الخروج
          </button>
        </div>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}
      <div className="grid two">
        <form className="card" aria-label="إنشاء حساب موظف" onSubmit={(event) => void onCreate(event)}>
          <h2>إنشاء حساب موظف</h2>
          <div className="field">
            <label htmlFor="newLogin">اسم الدخول</label>
            <input id="newLogin" value={loginName} onChange={(event) => setLoginName(event.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="newName">الاسم الظاهر</label>
            <input id="newName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="newPassword">كلمة المرور</label>
            <input id="newPassword" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </div>
          <GrantEditor
            idPrefix="create"
            branches={branches}
            value={createGrants}
            onChange={setCreateGrants}
          />
          <button type="submit" disabled={pendingCreate}>
            {pendingCreate ? "جارٍ الإنشاء…" : "إنشاء الحساب"}
          </button>
        </form>
        <section className="card">
          <h2>الحسابات</h2>
          {staff.length === 0 ? (
            <div className="empty">لا توجد حسابات موظفين بعد.</div>
          ) : (
            <div className="staff-list">
              {staff.map((account) => (
                <StaffCard
                  key={account.id}
                  account={account}
                  branches={branches}
                  resettingId={resettingId}
                  resetPassword={resetPassword}
                  pendingAction={pendingAction}
                  onResetPasswordChange={setResetPassword}
                  onToggleReset={(staffId) => {
                    setError("");
                    setNotice("");
                    setResetPassword("");
                    setResettingId((current) => (current === staffId ? null : staffId));
                  }}
                  onReset={async (staffId) => {
                    setError("");
                    setPendingAction(`reset-${staffId}`);
                    try {
                      await resetStaffPassword(staffId, resetPassword);
                      setNotice("تم تعيين كلمة المرور الجديدة.");
                      setResettingId(null);
                      setResetPassword("");
                    } catch (caught) {
                      setError(caught instanceof ApiError ? caught.messageAr : "تعذر إعادة التعيين.");
                    } finally {
                      setPendingAction("");
                    }
                  }}
                  onDisable={async (staffId) => {
                    setError("");
                    setPendingAction(`disable-${staffId}`);
                    try {
                      await disableStaff(staffId);
                      setNotice("تم تعطيل الحساب.");
                      await refresh();
                    } catch (caught) {
                      setError(caught instanceof ApiError ? caught.messageAr : "تعذر التعطيل.");
                    } finally {
                      setPendingAction("");
                    }
                  }}
                  onSaveGrants={async (staffId, grants) => {
                    setError("");
                    setPendingAction(`grants-${staffId}`);
                    try {
                      await setStaffGrants(staffId, grants);
                      setNotice("تم حفظ صلاحيات الفروع.");
                      await refresh();
                    } catch (caught) {
                      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ الصلاحيات.");
                    } finally {
                      setPendingAction("");
                    }
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function StaffCard({
  account,
  branches,
  resettingId,
  resetPassword,
  pendingAction,
  onResetPasswordChange,
  onToggleReset,
  onReset,
  onDisable,
  onSaveGrants,
}: {
  account: StaffAccountDto;
  branches: BranchDto[];
  resettingId: string | null;
  resetPassword: string;
  pendingAction: string;
  onResetPasswordChange: (value: string) => void;
  onToggleReset: (staffId: string) => void;
  onReset: (staffId: string) => Promise<void>;
  onDisable: (staffId: string) => Promise<void>;
  onSaveGrants: (
    staffId: string,
    grants: Array<{ branchId: string; cashier: boolean; orderRepresentative: boolean }>,
  ) => Promise<void>;
}) {
  const initial = useMemo(() => draftsFromAccount(branches, account), [account, branches]);
  const [drafts, setDrafts] = useState(initial);
  useEffect(() => {
    setDrafts(initial);
  }, [initial]);

  return (
    <article className="staff-item">
      <strong>{account.displayName}</strong>
      <p className="muted">
        {account.loginName} — {account.role === "manager" ? "مدير" : "موظف"}
        {account.disabled ? " — معطّل" : ""}
      </p>
      <p>{account.grants.map((grant) => grant.branch.nameAr).join("، ") || "لا توجد فروع"}</p>
      {account.role !== "manager" ? (
        <>
          <GrantEditor
            idPrefix={`edit-${account.id}`}
            branches={branches}
            value={drafts}
            onChange={setDrafts}
          />
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={pendingAction === `grants-${account.id}`}
              onClick={() => void onSaveGrants(account.id, toGrantPayload(branches, drafts))}
            >
              حفظ الفروع
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => onToggleReset(account.id)}
            >
              إعادة تعيين كلمة المرور
            </button>
            <button
              type="button"
              className="danger"
              disabled={pendingAction === `disable-${account.id}` || account.disabled}
              onClick={() => void onDisable(account.id)}
            >
              تعطيل
            </button>
          </div>
          {resettingId === account.id ? (
            <form
              className="reset-form"
              onSubmit={(event) => {
                event.preventDefault();
                void onReset(account.id);
              }}
            >
              <div className="field">
                <label htmlFor={`reset-${account.id}`}>كلمة المرور الجديدة</label>
                <input
                  id={`reset-${account.id}`}
                  type="password"
                  autoComplete="new-password"
                  value={resetPassword}
                  onChange={(event) => onResetPasswordChange(event.target.value)}
                  required
                />
              </div>
              <div className="actions">
                <button type="submit" disabled={pendingAction === `reset-${account.id}`}>
                  حفظ كلمة المرور
                </button>
                <button type="button" className="secondary" onClick={() => onToggleReset(account.id)}>
                  إلغاء
                </button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

function GrantEditor({
  idPrefix,
  branches,
  value,
  onChange,
}: {
  idPrefix: string;
  branches: BranchDto[];
  value: Record<string, GrantDraft>;
  onChange: (next: Record<string, GrantDraft>) => void;
}) {
  return (
    <fieldset className="grant-editor">
      <legend>الفروع والصلاحيات</legend>
      {branches.map((branch) => {
        const draft = value[branch.id] ?? { assigned: false, cashier: false, orderRepresentative: false };
        return (
          <div className="grant-block" key={branch.id}>
            <label htmlFor={`${idPrefix}-branch-${branch.id}`}>
              <input
                id={`${idPrefix}-branch-${branch.id}`}
                type="checkbox"
                checked={draft.assigned}
                onChange={(event) =>
                  onChange({
                    ...value,
                    [branch.id]: {
                      assigned: event.target.checked,
                      cashier: event.target.checked ? draft.cashier : false,
                      orderRepresentative: event.target.checked ? draft.orderRepresentative : false,
                    },
                  })
                }
              />
              {branch.nameAr}
            </label>
            <div className="checkboxes">
              <label htmlFor={`${idPrefix}-cashier-${branch.id}`}>
                <input
                  id={`${idPrefix}-cashier-${branch.id}`}
                  type="checkbox"
                  checked={draft.cashier}
                  disabled={!draft.assigned}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      [branch.id]: { ...draft, cashier: event.target.checked },
                    })
                  }
                />
                كاشير {forBranch(branch.nameAr)}
              </label>
              <label htmlFor={`${idPrefix}-rep-${branch.id}`}>
                <input
                  id={`${idPrefix}-rep-${branch.id}`}
                  type="checkbox"
                  checked={draft.orderRepresentative}
                  disabled={!draft.assigned}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      [branch.id]: { ...draft, orderRepresentative: event.target.checked },
                    })
                  }
                />
                ممثل الطلبات {forBranch(branch.nameAr)}
              </label>
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

function forBranch(nameAr: string): string {
  if (nameAr.startsWith("ال")) {
    return `لل${nameAr.slice(2)}`;
  }
  return `ل${nameAr}`;
}

function emptyDrafts(branches: BranchDto[]): Record<string, GrantDraft> {
  return Object.fromEntries(
    branches.map((branch) => [branch.id, { assigned: false, cashier: false, orderRepresentative: false }]),
  );
}

function draftsFromAccount(branches: BranchDto[], account: StaffAccountDto): Record<string, GrantDraft> {
  const drafts = emptyDrafts(branches);
  for (const grant of account.grants) {
    drafts[grant.branchId] = {
      assigned: true,
      cashier: grant.cashier,
      orderRepresentative: grant.orderRepresentative,
    };
  }
  return drafts;
}

function toGrantPayload(branches: BranchDto[], drafts: Record<string, GrantDraft>) {
  return branches
    .filter((branch) => drafts[branch.id]?.assigned)
    .map((branch) => ({
      branchId: branch.id,
      cashier: Boolean(drafts[branch.id]?.cashier),
      orderRepresentative: Boolean(drafts[branch.id]?.orderRepresentative),
    }));
}
