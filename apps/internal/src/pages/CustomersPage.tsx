import { type FormEvent, useEffect, useState } from "react";
import type { CustomerHistoryDto, CustomerSummaryDto, WorkspaceDto } from "@bravos/contracts";
import { ApiError, customerHistory, listCustomers } from "../api.ts";

export default function CustomersPage({ workspace }: { workspace: WorkspaceDto; onChanged: (workspace: WorkspaceDto | null) => void }) {
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerSummaryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [period, setPeriod] = useState<"month" | "year">("year");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<CustomerHistoryDto | null>(null);
  const [listError, setListError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [pending, setPending] = useState("");

  async function loadList(nextQuery: string, cursor?: string) {
    const page = await listCustomers({ q: nextQuery, limit: 40, ...(cursor ? { cursor } : {}) });
    setCustomers((current) => cursor ? [...current, ...page.customers] : page.customers);
    setNextCursor(page.nextCursor);
    return page.customers;
  }

  async function loadHistory(id: string, nextPeriod: "month" | "year") {
    setHistory(await customerHistory(id, nextPeriod));
  }

  useEffect(() => {
    let cancelled = false;
    setPending("list");
    setListError("");
    void loadList("")
      .catch((caught: unknown) => {
        if (!cancelled) setListError(caught instanceof ApiError ? caught.messageAr : "تعذر عرض الزبائن.");
      })
      .finally(() => {
        if (!cancelled) setPending("");
      });
    return () => { cancelled = true; };
  }, [workspace.staff.id]);

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    const nextQuery = query.trim();
    setPending("search");
    setListError("");
    setAppliedQuery(nextQuery);
    try {
      await loadList(nextQuery);
    } catch (caught) {
      setListError(caught instanceof ApiError ? caught.messageAr : "تعذر البحث عن الزبون.");
    } finally {
      setPending("");
    }
  }

  async function selectCustomer(customer: CustomerSummaryDto) {
    setSelectedId(customer.id);
    setHistory(null);
    setHistoryError("");
    setPending("history");
    try {
      await loadHistory(customer.id, period);
    } catch (caught) {
      setHistoryError(caught instanceof ApiError ? caught.messageAr : "تعذر عرض مشتريات الزبون.");
    } finally {
      setPending("");
    }
  }

  return (
    <main className="shell customers-page">
      <header className="page-hero"><h1>الزبائن</h1></header>
      <div className="split-layout">
        <section className="card" aria-label="سجل الزبائن">
          <form className="customer-search" aria-label="بحث عن زبون" onSubmit={(event) => void onSearch(event)}>
            <div className="field">
              <label htmlFor="customerLookupQuery">الاسم أو الهاتف</label>
              <input id="customerLookupQuery" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <button className="secondary" disabled={pending === "search" || pending === "list"}>{pending === "search" ? "جارٍ البحث…" : "بحث"}</button>
          </form>
          {listError ? <div className="error point-feedback" role="alert">{listError}</div> : null}
          {pending === "list" ? <p role="status">جارٍ تحميل الزبائن…</p> : null}
          {!pending && customers.length === 0 ? (
            <p className="empty">{appliedQuery ? "لا يوجد زبون مطابق." : "لا يوجد زبائن مسجلون."}</p>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table" data-testid="customer-list">
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>الهاتف</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id} data-selected={selectedId === customer.id ? "true" : "false"}>
                      <td>{customer.displayName}</td>
                      <td dir="ltr">{customer.normalizedPhone}</td>
                      <td className="table-actions">
                        <button type="button" className="secondary" aria-pressed={selectedId === customer.id} data-testid="customer-row" onClick={() => void selectCustomer(customer)}>
                          {selectedId === customer.id ? "معروض" : "عرض"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {nextCursor ? (
            <button type="button" className="secondary" disabled={pending === "more"} onClick={() => {
              setPending("more");
              setListError("");
              void loadList(appliedQuery, nextCursor)
                .catch((caught: unknown) => setListError(caught instanceof ApiError ? caught.messageAr : "تعذر عرض المزيد."))
                .finally(() => setPending(""));
            }}>{pending === "more" ? "جارٍ التحميل…" : "عرض المزيد"}</button>
          ) : null}
        </section>
        <section className="card" aria-label="مشتريات الزبون">
          <h2>منتجات مدفوعة</h2>
          <fieldset>
            <legend>الفترة</legend>
            <label><input type="radio" name="customer-period" checked={period === "month"} onChange={() => {
              setPeriod("month");
              if (selectedId) {
                setHistoryError("");
                void loadHistory(selectedId, "month").catch((caught: unknown) => setHistoryError(caught instanceof ApiError ? caught.messageAr : "تعذر عرض الفترة."));
              }
            }} /> هذا الشهر</label>
            <label><input type="radio" name="customer-period" checked={period === "year"} onChange={() => {
              setPeriod("year");
              if (selectedId) {
                setHistoryError("");
                void loadHistory(selectedId, "year").catch((caught: unknown) => setHistoryError(caught instanceof ApiError ? caught.messageAr : "تعذر عرض الفترة."));
              }
            }} /> هذه السنة</label>
          </fieldset>
          {historyError ? <div className="error point-feedback" role="alert">{historyError}</div> : null}
          {pending === "history" ? <p role="status">جارٍ تحميل المشتريات…</p> : null}
          {!selectedId ? <p className="empty">اختر زبوناً من السجل.</p> : null}
          {history ? (
            <>
              <p>{history.customer.displayName}</p>
              <p dir="ltr">{history.customer.normalizedPhone}</p>
              <p>العمليات: {history.purchaseCount}</p>
              {history.purchases.length === 0 ? <p>لا توجد مشتريات مدفوعة في هذه الفترة.</p> : (
                <div className="data-table-wrap">
                  <table className="data-table" data-testid="customer-history">
                    <thead>
                      <tr>
                        <th>المرجع</th>
                        <th>المنتج</th>
                        <th>الكمية</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.purchases.flatMap((purchase) => purchase.products.map((product, index) => (
                        <tr key={`${purchase.sourceId}-${index}`}>
                          <td>{index === 0 ? `${purchase.channel === "online" ? "أونلاين" : "فرع"} ${purchase.reference}` : ""}</td>
                          <td>{product.nameAr}{product.optionText ? ` — ${product.optionText}` : ""}</td>
                          <td>{product.quantity}</td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
