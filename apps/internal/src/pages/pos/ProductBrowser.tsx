import { useMemo, useState } from "react";
import type { CashierProductLookupDto } from "@bravos/contracts";
import { formatEgpFromPiasters } from "../../money.ts";

export function ProductBrowser({ products, quantities, selectedId, loading, message, onSelect, onRetry }: {
  products: CashierProductLookupDto[];
  quantities: Record<string, number>;
  selectedId: string | undefined;
  loading: boolean;
  message: string;
  onSelect: (product: CashierProductLookupDto) => void;
  onRetry: () => void;
}) {
  const [filter, setFilter] = useState("");
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
      <div className="field pos-browse-filter">
        <label htmlFor="pos-product-filter">ابحث بالاسم أو الكود</label>
        <input id="pos-product-filter" type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="اسم الصنف أو جزء من الكود" />
      </div>
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
            return <button className={`pos-product-tile${selectedId === product.id ? " is-selected" : ""}`} key={product.id} type="button" aria-pressed={selectedId === product.id} onClick={() => onSelect(product)} data-testid="pos-product-tile">
              <span className="pos-product-code">{product.code}</span>
              <strong>{product.nameAr}</strong>
              {product.categoryNameAr ? <span className="pos-product-category">{product.categoryNameAr}</span> : null}
              <span className="pos-product-price">{formatEgpFromPiasters(product.sellingPricePiasters)}</span>
              <span className={`pos-product-stock${available === 0 ? " is-unavailable" : ""}`}>{available > 0 ? `متاح بالفرع: ${available}` : "غير متوفر بالفرع"}</span>
            </button>;
          })}
        </div>
      )}
    </section>
  );
}
