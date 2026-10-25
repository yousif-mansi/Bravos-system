import { useEffect, useRef, useState } from "react";
import { accountGeneration, subscribeAccount } from "../account-session.ts";
import { Link, useSearchParams } from "react-router-dom";
import type { ManagerSaleDto, OnlineOrderDto, SaleDto, WorkspaceDto } from "@bravos/contracts";
import { ApiError, getSale, listOnlineOrders, listSales } from "../api.ts";
import { pos, saleFromOffline } from "../pos.ts";
import { formatEgpFromPiasters } from "../money.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { useRevealFeedback } from "../ui/useRevealFeedback.ts";
import { SaleSummary } from "./SaleSummary.tsx";

export default function SalesPage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
  const [searchParams] = useSearchParams();
  const requestedSaleId = searchParams.get("saleId");
  const [error, setError] = useState("");
  const [sales, setSales] = useState<SaleDto[]>([]);
  const [confirmedOrders, setConfirmedOrders] = useState<OnlineOrderDto[]>([]);
  const [ordersPhase, setOrdersPhase] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<SaleDto | ManagerSaleDto | null>(null);
  const generationRef = useRef(accountGeneration());
  const detailRequest = useRef(0);
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
          byId.set(sale.id, sale);
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
        setSelected(requestedResult.value);
      } else {
        setSelected((requestedSaleId ? rows.find((sale) => sale.id === requestedSaleId) : rows[0]) ?? null);
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

  async function openSale(id: string) {
    const generation = generationRef.current;
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
      setSelected(detail);
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

  return (
    <main className="shell">
      <header className="page-hero">
        <h1>المبيعات</h1>
        {workspace.capabilities.cashier ? (
          <Link className="button" to="/lookup" aria-label="نقطة البيع البحث عن منتج">نقطة البيع</Link>
        ) : null}
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {error ? <button type="button" className="secondary" disabled={loading || Boolean(loadingSaleId)} onClick={() => failedSaleId ? void openSale(failedSaleId) : setReloadRevision((current) => current + 1)}>{failedSaleId ? "إعادة محاولة فتح البيع" : "إعادة تحميل المبيعات"}</button> : null}
      {loading ? <p role="status">جارٍ تحميل المبيعات…</p> : null}
      {loadingSaleId ? <p role="status">جارٍ فتح تفاصيل البيع…</p> : null}
      <div className="grid two">
        <section className="card">
          <h2>مبيعات الفروع</h2>
          {!loading && salesLoaded && sales.length === 0 ? (
            <EmptyState title="مفيش مبيعات تظهر" message="أول ما تبيع، العملية هتظهر هنا." />
          ) : sales.length > 0 ? (
            <ul data-testid="sale-list">
              {sales.map((sale) => (
                <li key={sale.id}>
                  <button type="button" className="secondary" aria-pressed={selected?.id === sale.id} aria-busy={loadingSaleId === sale.id} disabled={loadingSaleId === sale.id} onClick={() => void openSale(sale.id)}>
                    {sale.reference ?? "بيع غير مزامن"} — {sale.soldByDisplayName} — {sale.branch.nameAr} — {formatEgpFromPiasters(sale.finalTotalPiasters)}
                    {sale.recordedAt ? "" : " — غير مزامن"}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        {workspace.staff.role === "manager" ? (
          <section className="card" data-testid="confirmed-online-sales">
            <h2>الطلبات الإلكترونية بعد التأكيد وحالات الإلغاء</h2>
            {ordersPhase === "loading" ? <p role="status">جارٍ تحميل الطلبات المؤكدة…</p> : ordersPhase === "error" ? <>
              <p className="error" role="alert">تعذر تحميل الطلبات المؤكدة. أعد محاولة التحميل.</p>
              <button type="button" className="secondary" disabled={loading || Boolean(loadingSaleId)} onClick={() => setReloadRevision((current) => current + 1)}>إعادة تحميل الطلبات المؤكدة</button>
            </> : confirmedOrders.length === 0 ? <p className="muted">لا توجد طلبات تم تأكيدها بعد.</p> : (
              <ul>
                {confirmedOrders.map((order) => (
                  <li key={order.id}>
                    <Link to={`/online-orders/${order.id}`}>
                      {order.reference} — {order.customerName} — {order.fulfillmentBranchId
                        ? workspace.authorizedBranches.find((branch) => branch.id === order.fulfillmentBranchId)?.nameAr ?? "—"
                        : "—"} — {formatEgpFromPiasters(order.confirmedQuote?.finalTotalPiasters ?? 0)} — {new Date(order.confirmedAt!).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })} — {onlineOrderStatus(order.status)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
        {selected ? (
          <div ref={detailFeedback.regionRef} className={`reveal-feedback${detailFeedback.highlighted ? " is-highlighted" : ""}`} data-testid="sale-detail-region" aria-busy={Boolean(loadingSaleId)}>
            <h2 ref={detailFeedback.headingRef} tabIndex={-1}>بيع {selected.reference ?? "غير مزامن"}</h2>
            <SaleSummary sale={selected} />
            {managerSale ? <Link className="button secondary" to={`/corrections?target=sale&id=${selected.id}`}>تصحيح تسجيل هذا البيع</Link> : null}
            {managerSale ? (
              <section className="card" data-testid="sale-costs">
                <h2>تكلفة الدفعات</h2>
                {managerSale.costsIncomplete ? <p>أساس التكلفة غير مكتمل.</p> : null}
                {managerSale.allocations.length === 0 ? (
                  <p className="muted">لا توجد تخصيصات تكلفة.</p>
                ) : (
                  <ul>
                    {managerSale.allocations.map((item) => (
                      <li key={`${item.batchId}-${item.variantId}`}>
                        {item.quantity} × {formatEgpFromPiasters(item.unitCostPiasters)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
          </div>
        ) : null}
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
