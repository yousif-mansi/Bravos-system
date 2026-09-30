import { type FormEvent, useEffect, useState } from "react";
import type { CategoryDto, CouponDiscountType, CouponDto, CouponWriteDto, ManagerProductDto } from "@bravos/contracts";
import { ApiError, createCoupon, listCoupons, updateCoupon } from "../api.ts";
import { egpInputToPiasters, formatEgpFromPiasters } from "../money.ts";
import { useRevealFeedback } from "../ui/useRevealFeedback.ts";

type Props = { products: ManagerProductDto[]; categories: CategoryDto[] };
type Form = {
  code: string; discountType: CouponDiscountType; percentage: string; fixedEgp: string;
  startsOn: string; endsOn: string; active: boolean; allowAutomaticOffer: boolean;
  usageLimit: string; productIds: string[]; categoryIds: string[];
};

function cairoToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function emptyForm(): Form {
  const today = cairoToday();
  return { code: "", discountType: "fixed", percentage: "10", fixedEgp: "0", startsOn: today,
    endsOn: today, active: false, allowAutomaticOffer: true, usageLimit: "1", productIds: [], categoryIds: [] };
}

export function CouponManager({ products, categories }: Props) {
  const [coupons, setCoupons] = useState<CouponDto[]>([]);
  const [form, setForm] = useState<Form>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const editFeedback = useRevealFeedback<HTMLFormElement>();

  useEffect(() => { void refresh(); }, []);

  async function refresh() {
    setPending(true);
    try { setCoupons(await listCoupons()); }
    catch (caught) { setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل الكوبونات."); }
    finally { setPending(false); }
  }

  function toggle(kind: "productIds" | "categoryIds", id: string, checked: boolean) {
    setForm((current) => ({ ...current, [kind]: checked
      ? [...new Set([...current[kind], id])] : current[kind].filter((value) => value !== id) }));
  }

  function edit(coupon: CouponDto) {
    setEditingId(coupon.id);
    setForm({ code: coupon.code, discountType: coupon.discountType,
      percentage: String((coupon.percentageBasisPoints ?? 0) / 100),
      fixedEgp: String((coupon.fixedDiscountPiasters ?? 0) / 100), startsOn: coupon.startsOn, endsOn: coupon.endsOn,
      active: coupon.active, allowAutomaticOffer: coupon.allowAutomaticOffer, usageLimit: String(coupon.usageLimit),
      productIds: coupon.productIds, categoryIds: coupon.categoryIds });
    setError(""); setNotice("");
    editFeedback.reveal();
  }

  function payload(): CouponWriteDto | null {
    const fixed = egpInputToPiasters(form.fixedEgp);
    const percentage = Math.round(Number(form.percentage) * 100);
    const usageLimit = Number(form.usageLimit);
    if (form.discountType === "fixed" && (fixed === null || fixed < 1)) { setError("أدخل قيمة كوبون أكبر من صفر."); return null; }
    if (form.discountType === "percentage" && (!Number.isSafeInteger(percentage) || percentage < 1 || percentage > 10_000)) { setError("أدخل نسبة أكبر من صفر وحتى 100٪."); return null; }
    if (!Number.isSafeInteger(usageLimit) || usageLimit < 1) { setError("أدخل حد استخدام صحيحاً أكبر من صفر."); return null; }
    return { code: form.code, discountType: form.discountType,
      percentageBasisPoints: form.discountType === "percentage" ? percentage : null,
      fixedDiscountPiasters: form.discountType === "fixed" ? fixed : null,
      startsOn: form.startsOn, endsOn: form.endsOn, active: form.active,
      allowAutomaticOffer: form.allowAutomaticOffer, usageLimit, productIds: form.productIds, categoryIds: form.categoryIds };
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    const body = payload(); if (!body) return;
    setPending(true);
    try {
      if (editingId) { await updateCoupon(editingId, body); setNotice("تم تحديث الكوبون."); }
      else { await createCoupon(body); setNotice("تم إنشاء الكوبون."); }
      setEditingId(null); setForm(emptyForm()); editFeedback.clearHighlight(); setCoupons(await listCoupons());
    } catch (caught) { setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ الكوبون."); }
    finally { setPending(false); }
  }

  return <section className="card stacked-form" aria-label="إدارة الكوبونات">
    <h2>الكوبونات</h2>
    <p className="muted">يُحتسب الاستخدام عند إتمام البيع فقط.</p>
    {error ? <div className="error" role="alert">{error}</div> : null}
    {notice ? <div className="notice" role="status">{notice}</div> : null}
    <form ref={editFeedback.regionRef} className={`reveal-feedback${editFeedback.highlighted ? " is-highlighted" : ""}`} aria-label={editingId ? "تعديل كوبون" : "إنشاء كوبون"} onSubmit={(event) => void submit(event)}>
      <h3 ref={editFeedback.headingRef} tabIndex={-1}>{editingId ? `تعديل الكوبون: ${form.code}` : "كوبون جديد"}</h3>
      <div className="grid two">
        <div className="field"><label htmlFor="couponManagerCode">كود الكوبون</label><input id="couponManagerCode" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
        <div className="field"><label htmlFor="couponUsageLimit">حد الاستخدام</label><input id="couponUsageLimit" type="number" min="1" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} /></div>
        <div className="field"><label htmlFor="couponType">نوع الخصم</label><select id="couponType" value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as CouponDiscountType })}><option value="fixed">قيمة ثابتة</option><option value="percentage">نسبة مئوية</option></select></div>
        {form.discountType === "fixed"
          ? <div className="field"><label htmlFor="couponFixed">الخصم بالجنيه</label><input id="couponFixed" value={form.fixedEgp} onChange={(e) => setForm({ ...form, fixedEgp: e.target.value })} /></div>
          : <div className="field"><label htmlFor="couponPercent">النسبة المئوية</label><input id="couponPercent" value={form.percentage} onChange={(e) => setForm({ ...form, percentage: e.target.value })} /></div>}
        <div className="field"><label htmlFor="couponStart">من تاريخ</label><input id="couponStart" type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></div>
        <div className="field"><label htmlFor="couponEnd">إلى تاريخ</label><input id="couponEnd" type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></div>
      </div>
      <fieldset className="offer-scope"><legend>المنتجات المؤهلة للكوبون</legend>{products.map((p) => <label key={p.id}><input type="checkbox" checked={form.productIds.includes(p.id)} onChange={(e) => toggle("productIds", p.id, e.target.checked)} /> {p.code} — {p.nameAr}</label>)}</fieldset>
      <fieldset className="offer-scope"><legend>التصنيفات المؤهلة للكوبون</legend>{categories.map((c) => <label key={c.id}><input type="checkbox" checked={form.categoryIds.includes(c.id)} onChange={(e) => toggle("categoryIds", c.id, e.target.checked)} /> {c.nameAr}</label>)}</fieldset>
      <div className="checkboxes"><label><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> مفعل</label><label><input type="checkbox" checked={form.allowAutomaticOffer} onChange={(e) => setForm({ ...form, allowAutomaticOffer: e.target.checked })} /> يسمح بالجمع مع عرض تلقائي</label></div>
      <div className="actions"><button disabled={pending} type="submit">{pending ? "جارٍ الحفظ…" : "حفظ الكوبون"}</button>{editingId ? <button type="button" className="secondary" onClick={() => { setEditingId(null); setForm(emptyForm()); editFeedback.clearHighlight(); }}>إلغاء التعديل</button> : null}</div>
    </form>
    <div className="staff-list">{coupons.map((coupon) => <article className="staff-item" data-testid="coupon-row" key={coupon.id}>
      <h3>{coupon.code}</h3><p>{coupon.discountType === "fixed" ? formatEgpFromPiasters(coupon.fixedDiscountPiasters ?? 0) : `${(coupon.percentageBasisPoints ?? 0) / 100}٪`} — استخدم {coupon.usedCount} من {coupon.usageLimit}</p>
      <p>{coupon.active ? "مفعل" : "متوقف"} — {coupon.allowAutomaticOffer ? "يسمح بالعرض التلقائي" : "منفرد"}</p>
      <button type="button" className="secondary" onClick={() => edit(coupon)}>تعديل</button>
    </article>)}</div>
  </section>;
}
