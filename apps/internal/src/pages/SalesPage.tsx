import { useEffect, useRef, useState } from "react";
import { accountGeneration, subscribeAccount } from "../account-session.ts";
import { Link, useSearchParams } from "react-router-dom";
import type { ManagerSaleDto, SaleDto, WorkspaceDto } from "@bravos/contracts";
import { ApiError, getSale, listSales } from "../api.ts";
import { pos, saleFromOffline } from "../pos.ts";
import { formatEgpFromPiasters } from "../money.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
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
  const [selected, setSelected] = useState<SaleDto | ManagerSaleDto | null>(null);
  const generationRef = useRef(accountGeneration());
  const canSeeCosts = workspace.staff.role === "manager" && workspace.capabilities.manageInventory;

  useEffect(() => {
    return subscribeAccount((payload) => {
      generationRef.current = payload.generation;
      if (payload.staffId !== workspace.staff.id) {
        setSales([]);
        setSelected(null);
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
    setSelected(null);
    setError("");
    void (async () => {
      const [localResult, remoteResult, requestedResult] = await Promise.allSettled([
        pos.listCompleted(staffId),
        listSales(),
        requestedSaleId ? getSale(requestedSaleId) : Promise.resolve(null),
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
      }
      const rows = [...byId.values()];
      setSales(rows);
      if (requestedResult.status === "fulfilled" && requestedResult.value) {
        setSelected(requestedResult.value);
      } else {
        setSelected((requestedSaleId ? rows.find((sale) => sale.id === requestedSaleId) : rows[0]) ?? null);
      }
      if (requestedSaleId && requestedResult.status === "rejected") {
        const caught = requestedResult.reason;
        setError(caught instanceof ApiError ? caught.messageAr : "تعذر فتح البيع المطلوب.");
      } else if (remoteResult.status === "rejected" && local.length === 0 && !requestedSaleId) {
        const caught = remoteResult.reason;
        setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل المبيعات.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestedSaleId, workspace.staff.id, workspace.staff.role]);

  async function openSale(id: string) {
    const generation = generationRef.current;
    const local = sales.find((sale) => sale.id === id);
    if (local && !local.recordedAt) {
      setSelected(local);
      return;
    }
    try {
      const detail = await getSale(id);
      if (generationRef.current !== generation) {
        return;
      }
      setSelected(detail);
    } catch (caught) {
      if (generationRef.current !== generation) {
        return;
      }
      if (local) {
        setSelected(local);
        return;
      }
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل البيع.");
    }
  }

  const managerSale = canSeeCosts && selected && "allocations" in selected ? selected : null;

  return (
    <main className="shell">
      <header className="page-hero">
        <h1>المبيعات</h1>
        {workspace.capabilities.cashier ? (
          <Link className="button" to="/lookup" aria-label="بيع نقدي البحث عن منتج">بيع نقدي</Link>
        ) : null}
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      <div className="grid two">
        <section className="card">
          <h2>قائمة المبيعات</h2>
          {sales.length === 0 ? (
            <EmptyState title="مفيش مبيعات تظهر" message="أول ما تبيع، العملية هتظهر هنا." />
          ) : (
            <ul data-testid="sale-list">
              {sales.map((sale) => (
                <li key={sale.id}>
                  <button type="button" className="secondary" onClick={() => void openSale(sale.id)}>
                    {sale.soldByDisplayName} — {sale.branch.nameAr} — {formatEgpFromPiasters(sale.finalTotalPiasters)}
                    {sale.recordedAt ? "" : " — غير مزامن"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {selected ? (
          <div>
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
