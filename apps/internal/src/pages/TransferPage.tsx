import { type FormEvent, useEffect, useRef, useState } from "react";
import type { ManagerProductDto, StockLocationDto, WorkspaceDto } from "@bravos/contracts";
import { ApiError, listProducts, listStockLocations, transferStock } from "../api.ts";
import { isNetworkFailure } from "../session.ts";

export default function TransferPage({ workspace }: { workspace: WorkspaceDto; onChanged: (workspace: WorkspaceDto | null) => void }) {
  const [locations, setLocations] = useState<StockLocationDto[]>([]);
  const [products, setProducts] = useState<ManagerProductDto[]>([]);
  const [sourceBranchId, setSourceBranchId] = useState("");
  const [destinationBranchId, setDestinationBranchId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const attemptRef = useRef<{ operationId: string; key: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listStockLocations(), listProducts()])
      .then(([nextLocations, nextProducts]) => {
        if (cancelled) return;
        setLocations(nextLocations);
        setProducts(nextProducts);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل أماكن المخزون.");
      });
    return () => { cancelled = true; };
  }, [workspace.staff.id]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = Number(quantity);
    if (!sourceBranchId || !destinationBranchId || !productId || !Number.isInteger(parsed) || parsed < 1) {
      setError("اختر المصدر والوجهة والمنتج وكمية صحيحة.");
      return;
    }
    setPending(true);
    setError("");
    setNotice("");
    const key = JSON.stringify({ sourceBranchId, destinationBranchId, productId, quantity: parsed });
    if (!attemptRef.current || attemptRef.current.key !== key) {
      attemptRef.current = { operationId: crypto.randomUUID(), key };
    }
    try {
      const result = await transferStock({
        operationId: attemptRef.current.operationId,
        sourceBranchId,
        destinationBranchId,
        productId,
        quantity: parsed,
      });
      attemptRef.current = null;
      setNotice(result.created ? "تم نقل الكمية." : "هذه العملية مسجّلة من قبل.");
      setQuantity("1");
    } catch (caught) {
      if (!isNetworkFailure(caught)) attemptRef.current = null;
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر نقل المخزون. أعد المحاولة بنفس البيانات إذا لم تظهر النتيجة.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="shell">
      <header className="page-hero"><h1>نقل المخزون</h1></header>
      {error ? <div className="error point-feedback" role="alert">{error}</div> : null}
      {notice ? <div className="notice point-feedback" role="status">{notice}</div> : null}
      <form className="card" aria-label="نقل كمية" onSubmit={(event) => void onSubmit(event)}>
        <div className="transfer-fields">
        <div className="field"><label htmlFor="transferSource">من</label>
          <select id="transferSource" value={sourceBranchId} onChange={(event) => setSourceBranchId(event.target.value)} required>
            <option value="">اختر المصدر</option>
            {locations.map((place) => <option key={place.id} value={place.id}>{place.nameAr}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="transferDestination">إلى</label>
          <select id="transferDestination" value={destinationBranchId} onChange={(event) => setDestinationBranchId(event.target.value)} required>
            <option value="">اختر الوجهة</option>
            {locations.map((place) => <option key={place.id} value={place.id}>{place.nameAr}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="transferProduct">المنتج</label>
          <select id="transferProduct" value={productId} onChange={(event) => setProductId(event.target.value)} required>
            <option value="">اختر المنتج</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.code} — {product.nameAr}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="transferQuantity">الكمية</label>
          <input id="transferQuantity" type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
        </div>
        </div>
        <button className="confirm" disabled={pending}>{pending ? "جارٍ الحفظ…" : "تأكيد النقل"}</button>
      </form>
    </main>
  );
}
