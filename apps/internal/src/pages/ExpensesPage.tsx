import { type FormEvent, useEffect, useMemo, useState } from "react";

import type { ExpenseCategoryDto, ExpenseDto, ExpenseTotalsDto, WorkspaceDto } from "@bravos/contracts";
import {
  ApiError,
  changeExpense,
  createExpense,
  createExpenseCategory,
  getExpenseTotals,
  listExpenseCategories,
  listExpenses,
  updateExpenseCategory,
  type ExpenseWrite,
} from "../api.ts";
import { egpInputToPiasters, formatEgpFromPiasters, piastersToEgpInput } from "../money.ts";
import { EmptyState } from "../ui/EmptyState.tsx";


function todayCairoDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function expenseValueText(value: ExpenseDto["effective"]): string {
  if (!value) return "ملغي — مفيش مبلغ";
  return `${formatEgpFromPiasters(value.amountPiasters)} — ${value.expenseDate} — ${value.category.nameAr} — ${value.description}`;
}

export default function ExpensesPage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
  const manager = workspace.staff.role === "manager";
  const [categories, setCategories] = useState<ExpenseCategoryDto[]>([]);
  const [expenses, setExpenses] = useState<ExpenseDto[]>([]);
  const [totals, setTotals] = useState<ExpenseTotalsDto | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayCairoDate);
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [changeType, setChangeType] = useState<"correction" | "cancellation">("correction");
  const [changeAmount, setChangeAmount] = useState("");
  const [changeDate, setChangeDate] = useState(todayCairoDate);
  const [changeCategoryId, setChangeCategoryId] = useState("");
  const [changeDescription, setChangeDescription] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [pendingCreate, setPendingCreate] = useState<ExpenseWrite | null>(null);
  const [pendingChange, setPendingChange] = useState<{
    expenseId: string;
    input: Parameters<typeof changeExpense>[1];
  } | null>(null);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selected = useMemo(() => expenses.find((item) => item.id === selectedId) ?? null, [expenses, selectedId]);
  const activeCategories = categories.filter((item) => item.active);

  async function refresh() {
    const [nextCategories, nextExpenses, nextTotals] = await Promise.all([
      listExpenseCategories(), listExpenses(), getExpenseTotals(),
    ]);
    setCategories(nextCategories);
    setExpenses(nextExpenses);
    setTotals(nextTotals);
    setSelectedId((current) => current && nextExpenses.some((item) => item.id === current) ? current : nextExpenses[0]?.id ?? null);
    if (!categoryId && nextCategories[0]) setCategoryId(nextCategories.find((item) => item.active)?.id ?? "");
  }

  useEffect(() => {
    let cancelled = false;
    void refresh().catch((caught) => {
      if (!cancelled) setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل المصروفات.");
    });
    return () => { cancelled = true; };
  }, [workspace.staff.id, workspace.activeBranch?.id]);

  useEffect(() => {
    if (!selected?.effective) return;
    setChangeAmount(piastersToEgpInput(selected.effective.amountPiasters));
    setChangeDate(selected.effective.expenseDate);
    setChangeCategoryId(selected.effective.category.id);
    setChangeDescription(selected.effective.description);
    setChangeReason("");
    setChangeType("correction");
  }, [selected?.id, selected?.revision]);

  async function submitExpense(event: FormEvent) {
    event.preventDefault();
    setError(""); setNotice("");
    const amountPiasters = egpInputToPiasters(amount);
    if (!amountPiasters || !categoryId || !description.trim()) {
      setError("أدخل قيمة موجبة وتاريخاً وفئة ووصفاً للمصروف.");
      return;
    }
    const payload = pendingCreate ?? {
      operationId: crypto.randomUUID(), amountPiasters, expenseDate, categoryId, description: description.trim(),
    };
    setPendingCreate(payload); setPending("create");
    try {
      const saved = await createExpense(payload);
      setPendingCreate(null); setAmount(""); setDescription(""); setSelectedId(saved.id);
      setNotice("تم حفظ المصروف واحتسابه في الإجمالي.");
      await refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status < 500) setPendingCreate(null);
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تأكيد الحفظ. أعد المحاولة بنفس العملية.");
    } finally { setPending(""); }
  }

  async function submitChange(event: FormEvent) {
    event.preventDefault();
    if (!selected?.effective) return;
    setError(""); setNotice("");
    if (!changeReason.trim()) { setError("سبب التعديل أو الإلغاء مطلوب."); return; }
    const correctionAmount = egpInputToPiasters(changeAmount);
    if (changeType === "correction" && (!correctionAmount || !changeCategoryId || !changeDescription.trim())) {
      setError("أدخل بيانات التصحيح كاملة بقيمة موجبة."); return;
    }
    const input = pendingChange?.expenseId === selected.id ? pendingChange.input : changeType === "cancellation" ? {
      operationId: crypto.randomUUID(), expectedRevision: selected.revision, type: changeType, reason: changeReason.trim(),
    } : {
      operationId: crypto.randomUUID(), expectedRevision: selected.revision, type: changeType, reason: changeReason.trim(),
      amountPiasters: correctionAmount!, expenseDate: changeDate, categoryId: changeCategoryId,
      description: changeDescription.trim(),
    };
    setPendingChange({ expenseId: selected.id, input });
    setPending("change");
    try {
      const changed = await changeExpense(selected.id, input);
      setPendingChange(null);
      setNotice(changeType === "cancellation" ? "تم إلغاء المصروف مع الاحتفاظ بالأصل." : "تم تصحيح المصروف مرة واحدة.");
      await refresh(); setSelectedId(changed.id);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status < 500) setPendingChange(null);
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تعديل المصروف.");
      if (caught instanceof ApiError && caught.status === 409) await refresh();
    } finally { setPending(""); }
  }

  async function addCategory(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice(""); setPending("category");
    try {
      const created = await createExpenseCategory(newCategory);
      setNewCategory(""); setCategoryId(created.id); setNotice("تمت إضافة فئة المصروف."); await refresh();
    } catch (caught) { setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ الفئة."); }
    finally { setPending(""); }
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    const category = categories.find((item) => item.id === editingCategoryId);
    if (!category) return;
    setPending("category-edit"); setError(""); setNotice("");
    try {
      await updateExpenseCategory(category.id, { nameAr: editingCategoryName, active: category.active });
      setEditingCategoryId(""); setNotice("تم تحديث فئة المصروف."); await refresh();
    } catch (caught) { setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحديث الفئة."); }
    finally { setPending(""); }
  }

  async function toggleCategory(category: ExpenseCategoryDto) {
    setPending("category-toggle"); setError(""); setNotice("");
    try {
      await updateExpenseCategory(category.id, { nameAr: category.nameAr, active: !category.active });
      setNotice(category.active ? "تم إيقاف الفئة للمدخلات الجديدة." : "تم تفعيل الفئة."); await refresh();
    } catch (caught) { setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحديث الفئة."); }
    finally { setPending(""); }
  }

  return (
    <main className="shell">
      <header className="page-hero">
        <h1>المصروفات</h1>
      </header>
      {typeof navigator !== "undefined" && !navigator.onLine ? <div className="error" role="alert">تسجيل المصروفات يتطلب اتصالاً.</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}

      <section className="card" data-testid="expense-totals">
        <h2>الإجمالي الفعلي</h2>
        <p className="expense-total">{formatEgpFromPiasters(totals?.totalPiasters ?? 0)}</p>
        {manager ? totals?.byBranch.map((item) => <p key={item.branch.id}>{item.branch.nameAr}: {formatEgpFromPiasters(item.totalPiasters)}</p>) : null}
      </section>

      <div className="grid two expense-layout">
        <form className="card" aria-label="تسجيل مصروف" onSubmit={(event) => void submitExpense(event)}>
          <h2>مصروف جديد</h2>
          {pendingCreate ? <p className="muted">هناك عملية حفظ غير مؤكدة؛ ستتم إعادة المحاولة بنفس المعرّف.</p> : null}
          <div className="field"><label htmlFor="expenseAmount">القيمة بالجنيه</label><input id="expenseAmount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={Boolean(pendingCreate)} required /></div>
          <div className="field"><label htmlFor="expenseDate">التاريخ</label><input id="expenseDate" type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} disabled={Boolean(pendingCreate)} required /></div>
          <div className="field"><label htmlFor="expenseCategory">الفئة</label><select id="expenseCategory" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={Boolean(pendingCreate)} required><option value="">اختر الفئة</option>{activeCategories.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></div>
          <div className="field"><label htmlFor="expenseDescription">الوصف</label><textarea id="expenseDescription" value={description} onChange={(event) => setDescription(event.target.value)} disabled={Boolean(pendingCreate)} required /></div>
          <div className="form-actions">
            <button disabled={pending === "create"}>{pending === "create" ? "جارٍ الحفظ…" : pendingCreate ? "إعادة محاولة الحفظ" : "حفظ المصروف"}</button>
          </div>
        </form>

        <section className="card"><h2>{manager ? "كل المصروفات" : "مصروفاتي في الفرع"}</h2>
          {expenses.length === 0 ? (
            <EmptyState title="لسه مفيش مصروفات" message="سجّل أول مصروف من النموذج جنب القائمة." />
          ) : (
            <div className="report-table-wrap" data-testid="expense-list">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الوصف</th>
                    <th>المبلغ</th>
                    <th>الفرع</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((item) => (
                    <tr key={item.id}>
                      <td>{item.effective?.description ?? item.original.description}</td>
                      <td>{item.status === "cancelled" ? "ملغي" : formatEgpFromPiasters(item.effective!.amountPiasters)}</td>
                      <td className="muted">{item.branch.nameAr} — {item.createdByDisplayName}</td>
                      <td className="table-actions">
                        <button className="secondary" onClick={() => setSelectedId(item.id)}>عرض التفاصيل</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {selected ? <section className="card expense-details" data-testid="expense-details"><h2>تفاصيل المصروف</h2>
        <p>الحالة: {selected.status === "cancelled" ? "ملغي" : "ساري"}</p>
        <p className="muted">سجله {selected.createdByDisplayName} في {selected.branch.nameAr} — {new Date(selected.recordedAt).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}</p>
        <p>الأصل: {formatEgpFromPiasters(selected.original.amountPiasters)} — {selected.original.expenseDate} — {selected.original.category.nameAr} — {selected.original.description}</p>
        {selected.effective ? <p>القيمة الفعلية: {formatEgpFromPiasters(selected.effective.amountPiasters)} — {selected.effective.expenseDate} — {selected.effective.category.nameAr} — {selected.effective.description}</p> : <p>القيمة الفعلية: صفر</p>}
        <h3>سجل التعديلات</h3>{selected.changes.length === 0 ? <p className="empty">لا توجد تعديلات.</p> : selected.changes.map((change) => (
          <article className="history-item" data-testid="expense-history-item" key={change.id}>
            <p>{change.type === "cancellation" ? "إلغاء" : "تصحيح"} — {change.reason}</p>
            <p>قبل: {expenseValueText(change.previous)}</p>
            <p>بعد: {expenseValueText(change.effective)}</p>
            <p className="muted">{change.changedByDisplayName} — {new Date(change.changedAt).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}</p>
          </article>
        ))}
        {manager && selected.effective ? <form className="stacked-form" aria-label="تصحيح أو إلغاء مصروف" onSubmit={(event) => void submitChange(event)}><h3>تصحيح أو إلغاء</h3>
          {pendingChange ? <p className="muted">هناك تعديل غير مؤكد؛ ستتم إعادة المحاولة بنفس المعرّف.</p> : null}
          <div className="field"><label htmlFor="changeType">الإجراء</label><select id="changeType" value={changeType} disabled={Boolean(pendingChange)} onChange={(event) => setChangeType(event.target.value as "correction" | "cancellation")}><option value="correction">تصحيح</option><option value="cancellation">إلغاء</option></select></div>
          {changeType === "correction" ? <><div className="field"><label htmlFor="changeAmount">القيمة المصححة بالجنيه</label><input id="changeAmount" value={changeAmount} disabled={Boolean(pendingChange)} onChange={(event) => setChangeAmount(event.target.value)} /></div><div className="field"><label htmlFor="changeDate">التاريخ المصحح</label><input id="changeDate" type="date" value={changeDate} disabled={Boolean(pendingChange)} onChange={(event) => setChangeDate(event.target.value)} /></div><div className="field"><label htmlFor="changeCategory">الفئة المصححة</label><select id="changeCategory" value={changeCategoryId} disabled={Boolean(pendingChange)} onChange={(event) => setChangeCategoryId(event.target.value)}>{activeCategories.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></div><div className="field"><label htmlFor="changeDescription">الوصف المصحح</label><textarea id="changeDescription" value={changeDescription} disabled={Boolean(pendingChange)} onChange={(event) => setChangeDescription(event.target.value)} /></div></> : null}
          <div className="field"><label htmlFor="changeReason">السبب</label><textarea id="changeReason" value={changeReason} disabled={Boolean(pendingChange)} onChange={(event) => setChangeReason(event.target.value)} required /></div><button className={changeType === "cancellation" ? "danger" : ""} disabled={pending === "change"}>{pending === "change" ? "جارٍ الحفظ…" : pendingChange ? "إعادة محاولة الإجراء" : "حفظ الإجراء"}</button>
        </form> : null}
      </section> : null}

      {manager ? <section className="card"><h2>فئات المصروفات</h2><form className="actions" aria-label="إضافة فئة مصروف" onSubmit={(event) => void addCategory(event)}><input aria-label="اسم الفئة الجديدة" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} required /><button disabled={pending === "category"}>إضافة فئة</button></form>
        <div className="staff-list category-list">{categories.map((item) => <article className="staff-item" key={item.id}><p>{item.nameAr} — {item.active ? "مفعلة" : "متوقفة"}</p><div className="actions"><button className="secondary" onClick={() => { setEditingCategoryId(item.id); setEditingCategoryName(item.nameAr); }}>تعديل الاسم</button><button className="secondary" onClick={() => void toggleCategory(item)}>{item.active ? "إيقاف" : "تفعيل"}</button></div>{editingCategoryId === item.id ? <form className="actions" onSubmit={(event) => void saveCategory(event)}><input aria-label="اسم الفئة المعدل" value={editingCategoryName} onChange={(event) => setEditingCategoryName(event.target.value)} required /><button disabled={pending === "category-edit"}>حفظ الاسم</button></form> : null}</article>)}</div>
      </section> : null}
    </main>
  );
}
