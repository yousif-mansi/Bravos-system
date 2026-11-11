import { useEffect, useRef, useState } from "react";
import { accountGeneration, subscribeAccount } from "../account-session.ts";
import { Link, useSearchParams } from "react-router-dom";
import type { ManagerSaleDto, OnlineOrderDto, SaleDto, WorkspaceDto } from "@bravos/contracts";
import { ApiError, getSale, listOnlineOrders, listSales } from "../api.ts";
import { pos, saleFromOffline } from "../pos.ts";
import { officialSaleNumber, withPreservedLocalReceipt } from "../receipt-number.ts";
import { releaseReceiptPrintResources } from "../receipts/index.ts";
import { formatEgpFromPiasters } from "../money.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { useRevealFeedback } from "../ui/useRevealFeedback.ts";
import { SaleSummary } from "./SaleSummary.tsx";
import { BusinessTabs, DetailPanel, TablePagination } from "../ui/BusinessUi.tsx";

export default function SalesPage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
  const [tab, setTab] = useState("branch");
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const [payment, setPayment] = useState("all");
  const [page, setPage] = useState(1);
  const [searchParams] = useSearchParams();
  const requestedSaleId = searchParams.get("saleId");
  const [error, setError] = useState("");
  const [sales, setSales] = useState<SaleDto[]>([]);
  const [confirmedOrders, setConfirmedOrders] = useState<OnlineOrderDto[]>([]);
  const [ordersPhase, setOrdersPhase] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<SaleDto | ManagerSaleDto | null>(null);
  const generationRef = useRef(accountGeneration());
  const detailRequest = useRef(0);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const detailFeedback = useRevealFeedback<HTMLDivElement>();
  const [loading, setLoading] = useState(true);
  const [salesLoaded, setSalesLoaded] = useState(false);
  const [loadingSaleId, setLoadingSaleId] = useState<string | null>(null);
  const [failedSaleId, setFailedSaleId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [reloadRevision, setReloadRevision] = useState(0);
  const canSeeCosts = workspace.staff.role === "manager" && workspace.capabilities.manageInventory;

  useEffect(() => {
    return subscribeAccount((payload) => {
      generationRef.current = payload.generation;
      releaseReceiptPrintResources();
      detailRequest.current += 1;
      setLoading(false);
      setLoadingSaleId(null);
      setFailedSaleId(null);
      setNotice("");
      if (payload.staffId !== workspace.staff.id) {
        setSales([]);
        setSalesLoaded(false);
        setConfirmedOrders([]);
        setOrdersPhase("loading");
        setSelected(null);
      } else {
        setReloadRevision((current) => current + 1);
      }
    });
  }, [workspace.staff.id]);

  useEffect(() => {
    let cancelled = false;
    const generation = accountGeneration();
    generationRef.current = generation;
    const staffId = workspace.staff.id;
    const role = workspace.staff.role;
    const stillCurrent = () => !cancelled && generationRef.current === generation;
    setSales([]);
    setSalesLoaded(false);
    setConfirmedOrders([]);
    setOrdersPhase(role === "manager" ? "loading" : "ready");
    setSelected(null);
    setError("");
    setLoading(true);
    detailRequest.current += 1;
    setLoadingSaleId(null);
    setFailedSaleId(null);
    setNotice("");
    void (async () => {
      const [localResult, remoteResult, requestedResult, ordersResult] = await Promise.allSettled([
        pos.listCompleted(staffId),
        listSales(),
        requestedSaleId ? getSale(requestedSaleId) : Promise.resolve(null),
        role === "manager" ? listOnlineOrders() : Promise.resolve([]),
      ]);
      if (!stillCurrent()) {
        return;
      }
      const local = localResult.status === "fulfilled" ? localResult.value.map(saleFromOffline) : [];
      const byId = new Map(local.map((sale) => [sale.id, sale]));
      if (remoteResult.status === "fulfilled") {
        const remote = remoteResult.value;
        for (const sale of remote) {
          if (role !== "manager" && sale.soldByStaffId !== staffId) {
            continue;
          }
          byId.set(sale.id, withPreservedLocalReceipt(sale, byId.get(sale.id), staffId));
        }
        setSalesLoaded(true);
      } else {
        setSalesLoaded(false);
      }
      const rows = [...byId.values()];
      setSales(rows);
      setLoading(false);
      if (role === "manager") {
        if (ordersResult.status === "fulfilled") {
          setConfirmedOrders(ordersResult.value.filter((order) => order.confirmedAt !== null));
          setOrdersPhase("ready");
        } else {
          setOrdersPhase("error");
        }
      } else {
        setOrdersPhase("ready");
      }
      if (requestedResult.status === "fulfilled" && requestedResult.value) {
        const requested = requestedResult.value;
        setSelected(withPreservedLocalReceipt(requested, local.find((sale) => sale.id === requested.id), staffId));
      } else {
        setSelected((requestedSaleId ? rows.find((sale) => sale.id === requestedSaleId) : null) ?? null);
      }
      if (requestedSaleId && requestedResult.status === "rejected") {
        const caught = requestedResult.reason;
        setError(caught instanceof ApiError ? caught.messageAr : "تعذر فتح البيع المطلوب.");
      } else if (remoteResult.status === "rejected" && !requestedSaleId) {
        const caught = remoteResult.reason;
        setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل المبيعات.");
        if (local.length) setNotice("نعرض المبيعات المحفوظة على هذا الجهاز حتى يعود الاتصال.");
      } else if (ordersResult.status === "rejected" && role === "manager") {
        setError("تعذر تحميل المبيعات الإلكترونية. أعد محاولة التحميل.");
      }
    })();
    return () => {
      cancelled = true;
      detailRequest.current += 1;
    };
  }, [requestedSaleId, workspace.staff.id, workspace.staff.role, reloadRevision]);

  useEffect(() => {
    return () => {
      releaseReceiptPrintResources();
    };
  }, [selected?.id, workspace.staff.id]);

  async function openSale(id: string) {
    const generation = generationRef.current;
    const staffId = workspace.staff.id;
    const request = ++detailRequest.current;
    const stillCurrent = () => generationRef.current === generation && detailRequest.current === request;
    setError("");
    setNotice("");
    setFailedSaleId(null);
    setLoadingSaleId(id);
    const local = sales.find((sale) => sale.id === id);
    if (local && !local.recordedAt) {
      setSelected(local);
      setLoadingSaleId(null);
      detailFeedback.reveal();
      return;
    }
    try {
      const detail = await getSale(id);
      if (!stillCurrent()) {
        return;
      }
      setSelected(withPreservedLocalReceipt(detail, local, staffId));
      detailFeedback.reveal();
    } catch (caught) {
      if (!stillCurrent()) {
        return;
      }
      setFailedSaleId(id);
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل البيع.");
      if (local) {
        setSelected(local);
        setNotice("نعرض التفاصيل المحفوظة على هذا الجهاز. أعد المحاولة لتحديثها.");
        detailFeedback.reveal();
        return;
      }
    } finally {
      if (stillCurrent()) setLoadingSaleId(null);
    }
  }

  const managerSale = canSeeCosts && selected && "allocations" in selected ? selected : null;

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesDate = (value: string) => !date || new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) === date;
  const filteredSales = sales.filter((sale) => matchesDate(sale.occurredAt)
    && (payment === "all" || sale.payment.method === payment)
    && [sale.reference, sale.receiptReference, sale.customerName, sale.customerPhone, sale.soldByDisplayName, sale.branch.nameAr, ...sale.lines.map((line) => line.variant.product.nameAr)].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)));
  const filteredOrders = confirmedOrders.filter((order) => matchesDate(order.confirmedAt!)
    && [order.reference, order.customerName, order.primaryPhone].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)));
  const total = tab === "branch" ? filteredSales.length : filteredOrders.length;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(total / 20)));
  const start = (currentPage - 1) * 20;

  return (
    <main className="shell business-page">
      <header className="business-page-header"><h1>المبيعات</h1>{workspace.capabilities.cashier ? <Link className="button" to="/lookup" aria-label="الكاشير البحث عن منتج">الكاشير</Link> : null}</header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {error ? <button type="button" className="secondary" disabled={loading || Boolean(loadingSaleId)} onClick={() => failedSaleId ? void openSale(failedSaleId) : setReloadRevision((current) => current + 1)}>{failedSaleId ? "إعادة محاولة فتح البيع" : "إعادة تحميل المبيعات"}</button> : null}
      {loading ? <p role="status">جارٍ تحميل المبيعات…</p> : null}
      {loadingSaleId ? <p role="status">جارٍ فتح تفاصيل البيع…</p> : null}
      <BusinessTabs id="sales-tabs" label="نوع المبيعات" value={tab} items={[{ id: "branch", label: "مبيعات الفروع" }, ...(workspace.staff.role === "manager" ? [{ id: "online", label: "الطلبات الإلكترونية" }] : [])]} onChange={(value) => { setTab(value); setPage(1); setSelected(null); }} />
      <div className="business-toolbar">
        <label>بحث <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="رقم البيع أو العميل" /></label>
        <label>التاريخ <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setPage(1); }} /></label>
        {tab === "branch" ? <label>طريقة الدفع <select value={payment} onChange={(event) => { setPayment(event.target.value); setPage(1); }}><option value="all">الكل</option><option value="cash">نقداً</option><option value="online">إلكترونياً</option><option value="split">مقسّم</option></select></label> : null}
      </div>
      <div className={selected && tab === "branch" ? "business-master-detail" : ""}>
        <section className="business-list-panel" role="tabpanel" id={`sales-tabs-panel-${tab}`} aria-labelledby={`sales-tabs-tab-${tab}`}>
          {tab === "branch" ? <>
            {!loading && salesLoaded && sales.length === 0 ? <EmptyState title="مفيش مبيعات تظهر" message="أول ما تبيع، العملية هتظهر هنا." /> : null}
            {sales.length > 0 ? <div className="business-table-wrap"><table className="business-table" data-testid="sale-list"><thead><tr><th>رقم البيع</th><th>التاريخ</th><th>العميل</th><th>الفرع / الموظف</th><th>الدفع</th><th>الإجمالي</th><th>المزامنة</th><th><span className="sr-only">التفاصيل</span></th></tr></thead><tbody>{filteredSales.slice(start, start + 20).map((sale) => <tr key={sale.id}>
              <td>{officialSaleNumber({ receiptReference: sale.receiptReference ?? null, reference: sale.reference, blockedIds: [sale.id, sale.operationId] })}</td><td>{new Date(sale.occurredAt).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}</td><td>{sale.customerName || "—"}</td><td>{sale.branch.nameAr} · {sale.soldByDisplayName}</td><td>{sale.payment.method === "cash" ? "نقداً" : sale.payment.method === "online" ? "إلكترونياً" : "مقسّم"}</td><td>{formatEgpFromPiasters(sale.finalTotalPiasters)}</td><td>{sale.recordedAt ? "مزامن" : "غير مزامن"}</td><td><button type="button" className="secondary" aria-pressed={selected?.id === sale.id} aria-busy={loadingSaleId === sale.id} disabled={loadingSaleId === sale.id} onClick={(event) => { detailTrigger.current = event.currentTarget; void openSale(sale.id); }}>فتح التفاصيل</button></td>
            </tr>)}</tbody></table></div> : null}
            {sales.length > 0 && filteredSales.length === 0 ? <p>لا توجد مبيعات تطابق البحث والمرشحات.</p> : null}
          </> : <div data-testid="confirmed-online-sales">
            {ordersPhase === "loading" ? <p role="status">جارٍ تحميل الطلبات المؤكدة…</p> : ordersPhase === "error" ? <><p className="error" role="alert">تعذر تحميل الطلبات المؤكدة.</p><button type="button" className="secondary" onClick={() => setReloadRevision((current) => current + 1)}>إعادة تحميل الطلبات المؤكدة</button></> : confirmedOrders.length === 0 ? <p className="muted">لا توجد طلبات تم تأكيدها بعد.</p> : <div className="business-table-wrap"><table className="business-table"><thead><tr><th>الطلب</th><th>العميل</th><th>فرع التجهيز</th><th>التأكيد</th><th>الإجمالي المتفق عليه</th><th>الحالة</th><th>التفاصيل</th></tr></thead><tbody>{filteredOrders.slice(start, start + 20).map((order) => <tr key={order.id}><td>{order.reference}</td><td>{order.customerName}</td><td>{workspace.authorizedBranches.find((branch) => branch.id === order.fulfillmentBranchId)?.nameAr ?? "—"}</td><td>{new Date(order.confirmedAt!).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}</td><td>{formatEgpFromPiasters(order.confirmedQuote?.finalTotalPiasters ?? 0)}</td><td>{onlineOrderStatus(order.status)}</td><td><Link to={`/online-orders/${order.id}`}>فتح التفاصيل</Link></td></tr>)}</tbody></table></div>}
            {ordersPhase === "ready" && confirmedOrders.length > 0 && filteredOrders.length === 0 ? <p>لا توجد طلبات تطابق البحث والمرشحات.</p> : null}
          </div>}
          {total > 0 ? <TablePagination page={currentPage} pageSize={20} total={total} onPageChange={setPage} /> : null}
        </section>
        {selected && tab === "branch" ? <DetailPanel title="تفاصيل البيع" onClose={() => { setSelected(null); detailTrigger.current?.focus(); }}><div ref={detailFeedback.regionRef} className={`reveal-feedback${detailFeedback.highlighted ? " is-highlighted" : ""}`} data-testid="sale-detail-region" aria-busy={Boolean(loadingSaleId)}>
          <h2 ref={detailFeedback.headingRef} tabIndex={-1}>بيع {officialSaleNumber({ receiptReference: selected.receiptReference ?? null, reference: selected.reference, blockedIds: [selected.id, selected.operationId] })}</h2>
          <SaleSummary key={selected.id} sale={selected} printDisabled={Boolean(loadingSaleId)} />
          {managerSale ? <Link className="button secondary" to={`/corrections?target=sale&id=${selected.id}`}>تصحيح تسجيل هذا البيع</Link> : null}
          {managerSale ? <section className="card" data-testid="sale-costs"><h2>تكلفة الدفعات</h2>{managerSale.costsIncomplete ? <p>أساس التكلفة غير مكتمل.</p> : null}{managerSale.allocations.length === 0 ? <p className="muted">لا توجد تخصيصات تكلفة.</p> : <ul>{managerSale.allocations.map((item) => <li key={`${item.batchId}-${item.variantId}`}>{item.quantity} × {formatEgpFromPiasters(item.unitCostPiasters)}</li>)}</ul>}</section> : null}
        </div></DetailPanel> : null}
      </div>
    </main>
  );
}

function onlineOrderStatus(status: OnlineOrderDto["status"]): string {
  const labels: Record<OnlineOrderDto["status"], string> = {
    pending: "قيد الانتظار",
    confirmed: "مؤكد",
    shipped: "تم الشحن",
    delivered: "تم التسليم",
    delivery_failed: "فشل التسليم",
    cancelled_unreachable: "ملغي لعدم الرد",
    cancelled_before_shipment: "ملغي قبل الشحن",
    cancelled_after_failed_delivery: "ملغي بعد فشل التسليم",
  };
  return labels[status];
}
