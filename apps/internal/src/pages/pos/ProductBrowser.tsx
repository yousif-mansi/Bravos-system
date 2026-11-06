import { useMemo, useState } from "react";
import type { CashierProductLookupDto } from "@bravos/contracts";
import { formatEgpFromPiasters } from "../../money.ts";

export function ProductBrowser({ products, quantities, cartQuantities, selectedId, loading, message, filter, disabled, onSelect, onAdd, onRetry }: {
  products: CashierProductLookupDto[];
  quantities: Record<string, number>;
  cartQuantities: Record<string, number>;
  selectedId: string | undefined;
  loading: boolean;
  message: string;
  filter: string;
  disabled: boolean;
  onSelect: (product: CashierProductLookupDto) => void;
  onAdd: (product: CashierProductLookupDto) => void;
  onRetry: () => void;
}) {
  const [category, setCategory] = useState("");
  const categories = useMemo(() => {
    const labels = new Map<string, string>();
    for (const product of products) {
      if (product.categoryId && product.categoryNameAr?.trim()) labels.set(product.categoryId, product.categoryNameAr);
    }
    return [...labels].map(([id, name]) => ({ id, name }));
  }, [products]);
  const activeCategory = categories.some((item) => item.id === category) ? category : "";
  const needle = filter.trim().toLocaleLowerCase("ar");
  const visible = products.filter((product) => (!activeCategory || product.categoryId === activeCategory) &&
    (!needle || `${product.nameAr} ${product.code}`.toLocaleLowerCase("ar").includes(needle)));
  return (
    <section className="pos-browser" aria-label="اختيار أصناف البيع" data-testid="pos-product-browser">
      <div className="pos-section-heading"><h2>الأصناف</h2><span className="muted">{visible.length} صنف</span></div>
      <div className="pos-categories" role="group" aria-label="تصنيفات الأصناف">
        <button type="button" aria-pressed={!activeCategory} onClick={() => setCategory("")}>الكل</button>
        {categories.map((item) => <button key={item.id} type="button" aria-pressed={activeCategory === item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}
      </div>
      {message ? <div className="pos-browse-message"><p>{message}</p><button type="button" className="secondary" onClick={onRetry}>إعادة تحميل الأصناف</button></div> : null}
      {loading ? <p className="muted">لحظات…</p> : visible.length === 0 ? (
        <div className="pos-browse-empty"><h3>{products.length ? "لا توجد أصناف مطابقة" : "لا توجد أصناف في القائمة"}</h3><p className="muted">{products.length ? "جرّب اسماً آخر أو اختر الكل." : "تظهر الأصناف هنا بعد حفظ قائمة نقطة البيع."}</p></div>
      ) : (
        <div className="pos-product-grid">
          {visible.map((product) => {
            const available = Math.max(0, quantities[product.operationalVariantId] ?? product.availableQuantity);
            return <div className={`pos-product-tile${selectedId === product.id ? " is-selected" : ""}`} key={product.id}>
              <button className="pos-product-select" data-testid="pos-product-tile" type="button" aria-pressed={selectedId === product.id} onClick={() => onSelect(product)}>
                <strong>{product.nameAr}</strong>
                <span className="pos-product-code">{product.code}</span>
                <span className="pos-product-price">{formatEgpFromPiasters(product.sellingPricePiasters)}</span>
                <span className={`pos-product-stock${available === 0 ? " is-unavailable" : ""}`}>{available > 0 ? `متاح بالفرع: ${available}` : "غير متوفر بالفرع"}</span>
              </button>
              <button className="pos-product-add" type="button" aria-label={`إضافة ${product.nameAr} إلى السلة`} disabled={disabled || !product.operationalVariantId || (cartQuantities[product.id] ?? 0) >= available} onClick={() => onAdd(product)}>إضافة</button>
            </div>;
          })}
        </div>
      )}
    </section>
  );
}
