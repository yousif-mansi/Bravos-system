import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CashierProductLookupDto, WorkspaceDto } from "@bravos/contracts";
import { ApiError, lookupProductByCode, signOut } from "../api.ts";
import { formatEgpFromPiasters } from "../money.ts";

export default function LookupPage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [product, setProduct] = useState<CashierProductLookupDto | null>(null);
  const [sizeId, setSizeId] = useState("");
  const [colorId, setColorId] = useState("");

  async function logout() {
    await signOut();
    onChanged(null);
    navigate("/login");
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const found = await lookupProductByCode(code);
      setProduct(found);
      setSizeId("");
      setColorId("");
    } catch (caught) {
      setProduct(null);
      setSizeId("");
      setColorId("");
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر البحث عن المنتج.");
    } finally {
      setPending(false);
    }
  }

  const sizes = useMemo(() => {
    if (!product) {
      return [];
    }
    const unique = new Map<string, string>();
    for (const variant of product.variants) {
      unique.set(variant.size.id, variant.size.nameAr);
    }
    return [...unique.entries()].map(([id, nameAr]) => ({ id, nameAr }));
  }, [product]);

  const colors = useMemo(() => {
    if (!product) {
      return [];
    }
    const unique = new Map<string, string>();
    for (const variant of product.variants) {
      if (!sizeId || variant.size.id === sizeId) {
        unique.set(variant.color.id, variant.color.nameAr);
      }
    }
    return [...unique.entries()].map(([id, nameAr]) => ({ id, nameAr }));
  }, [product, sizeId]);

  const selected = product?.variants.find((variant) => variant.size.id === sizeId && variant.color.id === colorId) ?? null;

  return (
    <main className="shell">
      <header className="brand">
        <div>
          <h1>البحث عن منتج</h1>
          <p className="muted">الفرع النشط: {workspace.activeBranch?.nameAr ?? "غير محدد"}</p>
        </div>
        <div className="actions">
          <Link className="button secondary" to="/workspace">العودة لمساحة العمل</Link>
          <button className="secondary" type="button" onClick={() => void logout()}>
            تسجيل الخروج
          </button>
        </div>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      <form className="card" aria-label="البحث برمز المنتج" onSubmit={(event) => void onSearch(event)}>
        <div className="field">
          <label htmlFor="lookupCode">رمز المنتج</label>
          <input id="lookupCode" value={code} onChange={(event) => setCode(event.target.value)} required />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? "جارٍ البحث…" : "بحث"}
        </button>
      </form>
      {product ? (
        <section className="card" data-testid="lookup-result">
          <h2>{product.nameAr}</h2>
          <p className="muted">رمز المنتج: {product.code}</p>
          {product.descriptionAr ? <p>{product.descriptionAr}</p> : null}
          <div className="field">
            <label htmlFor="lookupSize">المقاس</label>
            <select
              id="lookupSize"
              value={sizeId}
              onChange={(event) => {
                setSizeId(event.target.value);
                setColorId("");
              }}
            >
              <option value="">اختر مقاساً</option>
              {sizes.map((item) => (
                <option key={item.id} value={item.id}>{item.nameAr}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="lookupColor">اللون</label>
            <select id="lookupColor" value={colorId} onChange={(event) => setColorId(event.target.value)} disabled={!sizeId}>
              <option value="">اختر لوناً</option>
              {colors.map((item) => (
                <option key={item.id} value={item.id}>{item.nameAr}</option>
              ))}
            </select>
          </div>
          {selected ? (
            <div data-testid="selected-variant">
              <p>سعر البيع: {formatEgpFromPiasters(selected.sellingPricePiasters)}</p>
              <p data-testid="available-quantity">الكمية المتاحة: {selected.availableQuantity}</p>
              {selected.availableQuantity === 0 ? (
                <p className="muted">غير متوفر في المخزون حتى يتم الاستلام.</p>
              ) : null}
            </div>
          ) : (
            <p className="muted">اختر المقاس واللون لعرض سعر البيع.</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
