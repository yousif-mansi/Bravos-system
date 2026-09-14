import { useEffect, useRef, useState } from "react";
import { accountGeneration, subscribeAccount } from "../account-session.ts";
import { Link, useNavigate } from "react-router-dom";
import type { ManagerSaleDto, SaleDto, WorkspaceDto } from "@bravos/contracts";
import { ApiError, getSale, listSales } from "../api.ts";
import { pos, saleFromOffline } from "../pos.ts";
import { signOutPreservingSales } from "../session.ts";
import { formatEgpFromPiasters } from "../money.ts";
import { SaleSummary } from "./SaleSummary.tsx";

export default function SalesPage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [sales, setSales] = useState<SaleDto[]>([]);
  const [selected, setSelected] = useState<SaleDto | ManagerSaleDto | null>(null);
  const generationRef = useRef(accountGeneration());
  const canSeeCosts = workspace.staff.role === "manager" && workspace.capabilities.manageInventory;

  async function logout() {
    const accepted = await signOutPreservingSales(workspace.staff.id);
    if (!accepted) {
      return;
    }
    await onChanged(null);
    navigate("/login");
  }

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
    const generation = accountGeneration();
    generationRef.current = generation;
    const staffId = workspace.staff.id;
    const role = workspace.staff.role;
    setSales([]);
    setSelected(null);
    setError("");
    void (async () => {
      const local = (await pos.listCompleted(staffId)).map(saleFromOffline);
      if (generationRef.current !== generation) {
        return;
      }
      try {
        const remote = await listSales();
        if (generationRef.current !== generation) {
          return;
        }
        const byId = new Map(local.map((sale) => [sale.id, sale]));
        for (const sale of remote) {
          if (role !== "manager" && sale.soldByStaffId !== staffId) {
            continue;
          }
          byId.set(sale.id, sale);
        }
        const rows = [...byId.values()];
        setSales(rows);
        setSelected(rows[0] ?? null);
      } catch (caught: unknown) {
        if (generationRef.current !== generation) {
          return;
        }
        if (local.length > 0) {
          setSales(local);
          setSelected(local[0] ?? null);
          return;
        }
        setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل المبيعات.");
      }
    })();
  }, [workspace.staff.id, workspace.staff.role]);

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
      <header className="brand">
        <div>
          <h1>المبيعات</h1>
          <p className="muted">الفرع النشط: {workspace.activeBranch?.nameAr ?? "غير محدد"}</p>
        </div>
        <div className="actions">
          {workspace.capabilities.cashier ? (
            <Link className="button secondary" to="/lookup">نقطة البيع</Link>
          ) : null}
          <Link className="button secondary" to="/workspace">العودة لمساحة العمل</Link>
          <button className="secondary" type="button" onClick={() => void logout()}>
            تسجيل الخروج
          </button>
        </div>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      <div className="grid two">
        <section className="card">
          <h2>قائمة المبيعات</h2>
          {sales.length === 0 ? (
            <p className="muted">لا توجد مبيعات ظاهرة لحسابك.</p>
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
