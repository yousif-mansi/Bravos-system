import { type FormEvent, useEffect, useState } from "react";
import type { SupplierDto, SupplierPurchaseDto, WorkspaceDto } from "@bravos/contracts";
import { ApiError, createSupplier, listPurchases, listSuppliers } from "../api.ts";
import { formatEgpFromPiasters } from "../money.ts";

export default function SuppliersPage({ workspace }: { workspace: WorkspaceDto; onChanged: (workspace: WorkspaceDto | null) => void }) {
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  const [purchases, setPurchases] = useState<SupplierPurchaseDto[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");

  async function load(nextSupplierId = supplierId) {
    const [nextSuppliers, nextPurchases] = await Promise.all([
      listSuppliers(),
      listPurchases(nextSupplierId || undefined),
    ]);
    setSuppliers(nextSuppliers);
    setPurchases(nextPurchases);
  }

  useEffect(() => {
    let cancelled = false;
    void load().catch((caught: unknown) => {
      if (!cancelled) setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل الموردين.");
    });
    return () => { cancelled = true; };
  }, [workspace.staff.id]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setPending("create");
    setError("");
    setNotice("");
    try {
      const created = await createSupplier(nameAr);
      setNameAr("");
      setSupplierId(created.id);
      setNotice("تم حفظ المورد.");
      await load(created.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ المورد.");
    } finally {
      setPending("");
    }
  }

  return (
    <main className="shell">
      <header className="page-hero"><h1>الموردون</h1></header>
      {error ? <div className="error point-feedback" role="alert">{error}</div> : null}
      {notice ? <div className="notice point-feedback" role="status">{notice}</div> : null}
      <form className="card supplier-create" aria-label="مورد جديد" onSubmit={(event) => void onCreate(event)}>
        <div className="field"><label htmlFor="supplierName">اسم المورد</label>
          <input id="supplierName" value={nameAr} onChange={(event) => setNameAr(event.target.value)} required />
        </div>
        <button className="confirm" disabled={pending === "create"}>{pending === "create" ? "جارٍ الحفظ…" : "حفظ المورد"}</button>
      </form>
      <section className="card">
        <div className="field"><label htmlFor="supplierFilter">سجل المورد</label>
          <select id="supplierFilter" value={supplierId} onChange={(event) => {
            const next = event.target.value;
            setSupplierId(next);
            void load(next).catch((caught: unknown) => setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل المشتريات."));
          }}>
            <option value="">كل المشتريات</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.nameAr}</option>)}
          </select>
        </div>
        {purchases.length === 0 ? <p className="empty">لا توجد مشتريات لهذا الاختيار.</p> : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>المورد</th>
                  <th>التاريخ</th>
                  <th>التكلفة</th>
                  <th>الأصناف</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((purchase) => (
                  <tr key={purchase.receiptId}>
                    <td>{purchase.supplierNameAr ?? "بدون مورد"}</td>
                    <td>{purchase.receiptDate}</td>
                    <td>{formatEgpFromPiasters(purchase.totalCostPiasters)}</td>
                    <td>{purchase.products.map((product) => `${product.nameAr} × ${product.quantity}`).join("، ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
