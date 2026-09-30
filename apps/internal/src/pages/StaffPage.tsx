import { type FormEvent, useEffect, useMemo, useState } from "react";

import type { BranchDto, StaffAccountDto, WorkspaceDto } from "@bravos/contracts";
import {
  ApiError,
  createStaff,
  disableStaff,
  listStaff,
  resetStaffPassword,
  setStaffGrants,
} from "../api.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { useRevealFeedback } from "../ui/useRevealFeedback.ts";

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
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);

  async function refresh() {
    setStaff(await listStaff());
  }

  useEffect(() => {
    setLoading(true); setLoadFailed(false); setError("");
    void refresh().catch((caught: unknown) => {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل الموظفين.");
      setLoadFailed(true);
    }).finally(() => setLoading(false));
  }, [loadRevision]);

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

  return (
    <main className="shell">
      <header className="page-hero">
        <h1>إدارة الموظفين</h1>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}
      {loading ? <p role="status">جارٍ تحميل الموظفين…</p> : null}
      {loadFailed ? <button className="secondary" type="button" disabled={loading} onClick={() => setLoadRevision((current) => current + 1)}>إعادة تحميل الموظفين</button> : null}
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
            disabled={pendingCreate}
            branches={branches}
            value={createGrants}
            onChange={setCreateGrants}
          />
          <div className="form-actions">
            <button type="submit" disabled={pendingCreate}>
              {pendingCreate ? "جارٍ الإنشاء…" : "إنشاء الحساب"}
            </button>
          </div>
        </form>
        <section className="card">
          <h2>الحسابات</h2>
          {!loading && !loadFailed && staff.length === 0 ? (
            <EmptyState title="لسه مفيش موظفين" message="أنشئ أول حساب من النموذج جنب القائمة." />
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
  const resetFeedback = useRevealFeedback<HTMLFormElement>();
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
            disabled={Boolean(pendingAction)}
            branches={branches}
            value={drafts}
            onChange={setDrafts}
          />
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              disabled={Boolean(pendingAction)}
              aria-busy={pendingAction === `grants-${account.id}`}
              onClick={() => void onSaveGrants(account.id, toGrantPayload(branches, drafts))}
            >
              {pendingAction === `grants-${account.id}` ? "جارٍ حفظ الفروع…" : "حفظ الفروع"}
            </button>
            <button type="button" className="secondary" disabled={Boolean(pendingAction)} aria-expanded={resettingId === account.id} onClick={() => { onToggleReset(account.id); if (resettingId !== account.id) resetFeedback.reveal(); else resetFeedback.clearHighlight(); }}>
              إعادة تعيين كلمة المرور
            </button>
            <button
              type="button"
              className="danger"
              disabled={Boolean(pendingAction) || account.disabled}
              aria-busy={pendingAction === `disable-${account.id}`}
              onClick={() => void onDisable(account.id)}
            >
              {pendingAction === `disable-${account.id}` ? "جارٍ تعطيل الحساب…" : "تعطيل"}
            </button>
          </div>
          {resettingId === account.id ? (
            <form
              ref={resetFeedback.regionRef}
              className={`reset-form reveal-feedback${resetFeedback.highlighted ? " is-highlighted" : ""}`}
              aria-label={`إعادة تعيين كلمة مرور ${account.displayName}`}
              aria-busy={pendingAction === `reset-${account.id}`}
              onSubmit={(event) => {
                event.preventDefault();
                void onReset(account.id);
              }}
            >
              <h3 ref={resetFeedback.headingRef} tabIndex={-1}>إعادة تعيين كلمة مرور {account.displayName}</h3>
              <div className="field">
                <label htmlFor={`reset-${account.id}`}>كلمة المرور الجديدة</label>
                <input
                  id={`reset-${account.id}`}
                  type="password"
                  autoComplete="new-password"
                  value={resetPassword}
                  onChange={(event) => onResetPasswordChange(event.target.value)}
                  required
                  disabled={Boolean(pendingAction)}
                />
              </div>
              <div className="form-actions">
                <button type="button" className="secondary" disabled={Boolean(pendingAction)} onClick={() => { onToggleReset(account.id); resetFeedback.clearHighlight(); }}>
                  إلغاء
                </button>
                <button type="submit" disabled={pendingAction === `reset-${account.id}`}>
                  {pendingAction === `reset-${account.id}` ? "جارٍ حفظ كلمة المرور…" : "حفظ كلمة المرور"}
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
  disabled = false,
  branches,
  value,
  onChange,
}: {
  idPrefix: string;
  disabled?: boolean;
  branches: BranchDto[];
  value: Record<string, GrantDraft>;
  onChange: (next: Record<string, GrantDraft>) => void;
}) {
  return (
    <fieldset className="grant-editor" disabled={disabled}>
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
