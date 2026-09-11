import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ManagerSaleDto, SaleDto, WorkspaceDto } from "@bravos/contracts";
import { ApiError, getSale, listSales, signOut } from "../api.ts";
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

  async function logout() {
    await signOut();
    onChanged(null);
    navigate("/login");
  }

  useEffect(() => {
    void listSales()
      .then((rows) => {
        setSales(rows);
        setSelected(rows[0] ?? null);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل المبيعات.");
      });
  }, []);

  async function openSale(id: string) {
    try {
      const detail = await getSale(id);
      setSelected(detail);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل البيع.");
    }
  }

  const managerSale = selected && "allocations" in selected ? selected : null;

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
