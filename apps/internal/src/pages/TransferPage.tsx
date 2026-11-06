import { type FormEvent, useEffect, useRef, useState } from "react";
import type { ManagerProductDto, ProductLocationStockDto, StockLocationDto, WorkspaceDto } from "@bravos/contracts";
import { ApiError, listProducts, listStockLocations, transferStock } from "../api.ts";
import { isNetworkFailure } from "../session.ts";
import { Modal } from "../ui/BusinessUi.tsx";

export function TransferPanel({ workspace, onDirtyChange, active = true, stockRows, onCompleted }: {
  workspace: WorkspaceDto;
  onDirtyChange?: (dirty: boolean) => void;
  active?: boolean;
  stockRows?: ProductLocationStockDto[] | null;
  onCompleted?: () => void;
}) {
  const [locations, setLocations] = useState<StockLocationDto[]>([]);
  const [products, setProducts] = useState<ManagerProductDto[]>([]);
  const [sourceBranchId, setSourceBranchId] = useState("");
  const [destinationBranchId, setDestinationBranchId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const inFlightRef = useRef(false);
  const attemptRef = useRef<{ operationId: string; key: string } | null>(null);
  const selectionRef = useRef({ sourceBranchId, destinationBranchId, productId });
  selectionRef.current = { sourceBranchId, destinationBranchId, productId };

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoadError("");
    void Promise.all([listStockLocations(), listProducts()])
      .then(([nextLocations, nextProducts]) => {
        if (cancelled) return;
        // Keep selected choices available while a draft or uncertain attempt is retained.
        const selection = selectionRef.current;
        setLocations((previous) => [...nextLocations, ...previous.filter((item) =>
          (item.id === selection.sourceBranchId || item.id === selection.destinationBranchId) && !nextLocations.some((next) => next.id === item.id),
        )]);
        setProducts((previous) => [...nextProducts, ...previous.filter((item) =>
          item.id === selection.productId && !nextProducts.some((next) => next.id === item.id),
        )]);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setLoadError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل أماكن المخزون.");
      });
    return () => { cancelled = true; };
  }, [workspace.staff.id, active, loadAttempt]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (inFlightRef.current) return;
    const parsed = Number(quantity);
    if (!sourceBranchId || !destinationBranchId || !productId || !Number.isInteger(parsed) || parsed < 1) {
      setError("اختر المصدر والوجهة والمنتج وكمية صحيحة.");
      return;
    }
    if (sourceBranchId === destinationBranchId) {
      setError("يجب أن يختلف المصدر عن الوجهة.");
      return;
    }
    setError("");
    setReviewOpen(true);
  }

  async function confirmTransfer() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const parsed = Number(quantity);
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
      setReviewOpen(false);
      onCompleted?.();
      setQuantity("1");
      onDirtyChange?.(false);
    } catch (caught) {
      if (!isNetworkFailure(caught)) attemptRef.current = null;
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر نقل المخزون. أعد المحاولة بنفس البيانات إذا لم تظهر النتيجة.");
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }

  const selectedProduct = products.find((item) => item.id === productId);
  const selectedSource = locations.find((item) => item.id === sourceBranchId);
  const selectedDestination = locations.find((item) => item.id === destinationBranchId);
  const stockRow = stockRows?.find((row) => row.productId === productId);
  const sourceBalance = stockRow ? (stockRow.locations.find((place) => place.branchId === sourceBranchId)?.quantity ?? 0) : undefined;

  return (
    <div className="transfer-panel">
      <h2>نقل المخزون</h2>
      {loadError ? <div className="error point-feedback" role="alert">{loadError} <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>إعادة المحاولة</button></div> : null}
      {error ? <div className="error point-feedback" role="alert">{error}</div> : null}
      {notice ? <div className="notice point-feedback" role="status">{notice}</div> : null}
      <form className="card" aria-label="نقل كمية" onSubmit={(event) => void onSubmit(event)}>
        <div className="transfer-fields">
        <div className="field"><label htmlFor="transferSource">من</label>
          <select id="transferSource" value={sourceBranchId} onChange={(event) => { setSourceBranchId(event.target.value); onDirtyChange?.(true); }} required>
            <option value="">اختر المصدر</option>
            {locations.map((place) => <option key={place.id} value={place.id} disabled={place.id === destinationBranchId}>{place.nameAr}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="transferDestination">إلى</label>
          <select id="transferDestination" value={destinationBranchId} onChange={(event) => { setDestinationBranchId(event.target.value); onDirtyChange?.(true); }} required>
            <option value="">اختر الوجهة</option>
            {locations.map((place) => <option key={place.id} value={place.id} disabled={place.id === sourceBranchId}>{place.nameAr}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="transferProduct">المنتج</label>
          <select id="transferProduct" value={productId} onChange={(event) => { setProductId(event.target.value); onDirtyChange?.(true); }} required>
            <option value="">اختر المنتج</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.code} — {product.nameAr}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="transferQuantity">الكمية</label>
          <input id="transferQuantity" type="number" min="1" step="1" value={quantity} onChange={(event) => { setQuantity(event.target.value); onDirtyChange?.(true); }} required />
        </div>
        </div>
        {productId && sourceBranchId ? <p>المتاح في المصدر: {sourceBalance === undefined ? "غير متاح حالياً" : sourceBalance}</p> : null}
        <button className="confirm" disabled={pending}>مراجعة النقل</button>
      </form>
      <Modal open={reviewOpen} title="مراجعة نقل المخزون" onClose={() => setReviewOpen(false)} closeDisabled={pending}>
        <p>المنتج: {selectedProduct ? `${selectedProduct.nameAr} — ${selectedProduct.code}` : "—"}</p>
        <p>من: {selectedSource?.nameAr ?? "—"} · إلى: {selectedDestination?.nameAr ?? "—"}</p>
        <p>الكمية: {quantity} · المتاح في المصدر: {sourceBalance === undefined ? "غير متاح حالياً" : sourceBalance}</p>
        {error ? <div className="error" role="alert">{error}</div> : null}
        <div className="actions"><button type="button" className="confirm" disabled={pending} onClick={() => void confirmTransfer()}>{pending ? "جارٍ الحفظ…" : "تأكيد النقل"}</button><button type="button" className="secondary" disabled={pending} onClick={() => setReviewOpen(false)}>العودة للتعديل</button></div>
      </Modal>
    </div>
  );
}

export default function TransferPage({ workspace }: { workspace: WorkspaceDto; onChanged: (workspace: WorkspaceDto | null) => void }) {
  return <main className="shell"><TransferPanel workspace={workspace} /></main>;
}
