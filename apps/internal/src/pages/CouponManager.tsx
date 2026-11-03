import { type FormEvent, useEffect, useRef, useState } from "react";
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
  const [action, setAction] = useState<"save" | "refresh" | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [listStale, setListStale] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const editFeedback = useRevealFeedback<HTMLFormElement>();

  useEffect(() => { void refresh(); }, []);

  function begin(next: "save" | "refresh") {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setAction(next);
    return true;
  }

  function finish() {
    pendingRef.current = false;
    setPending(false);
    setAction(null);
  }

  async function refresh() {
    setPending(true);
    setLoadFailed(false); setError("");
    try { setCoupons(await listCoupons()); setLoaded(true); }
    catch (caught) { setLoadFailed(true); setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل الكوبونات."); }
    finally { setPending(false); }
  }

  async function reloadCoupons() {
    if (!begin("refresh")) return;
    try {
      setCoupons(await listCoupons());
      setListStale(false);
      setRefreshError("");
    } catch (caught) {
      setListStale(true);
      setRefreshError(couponRefreshFailureText(caught));
    } finally {
      finish();
    }
  }

  function toggle(kind: "productIds" | "categoryIds", id: string, checked: boolean) {
    setForm((current) => ({ ...current, [kind]: checked
      ? [...new Set([...current[kind], id])] : current[kind].filter((value) => value !== id) }));
  }

  function edit(coupon: CouponDto) {
    if (pendingRef.current || listStale) return;
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
    event.preventDefault();
    if (pendingRef.current) return;
    setError(""); setNotice("");
    const body = payload();
    if (!body) return;
    if (!begin("save")) return;
    const savingId = editingId;
    try {
      try {
        if (savingId) await updateCoupon(savingId, body);
        else await createCoupon(body);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ الكوبون.");
        return;
      }
      setNotice(savingId ? "تم تحديث الكوبون." : "تم إنشاء الكوبون.");
      setEditingId(null); setForm(emptyForm()); editFeedback.clearHighlight();
      try {
        setCoupons(await listCoupons());
        setListStale(false);
        setRefreshError("");
      } catch (caught) {
        setListStale(true);
        setRefreshError(couponRefreshFailureText(caught));
      }
    } finally {
      finish();
    }
  }

  if (!loaded) return <section className="card" aria-label="إدارة الكوبونات"><h2>الكوبونات</h2>{loadFailed ? <><p className="error" role="alert">{error}</p><button type="button" disabled={pending} onClick={() => void refresh()}>إعادة تحميل الكوبونات</button></> : <p role="status">جارٍ تحميل الكوبونات…</p>}</section>;

  return <section className="card stacked-form" aria-label="إدارة الكوبونات">
    <h2>الكوبونات</h2>
    {error ? <div className="error" role="alert">{error}</div> : null}
    {notice ? <div className="notice" role="status">{notice}</div> : null}
    {listStale && refreshError ? <p className="error" role="alert">{refreshError}</p> : null}
    {listStale ? <button type="button" className="secondary" aria-busy={action === "refresh"} disabled={pending} onClick={() => void reloadCoupons()}>{action === "refresh" ? "جارٍ تحديث القائمة…" : "إعادة تحميل الكوبونات"}</button> : null}
    <form ref={editFeedback.regionRef} className={`reveal-feedback${editFeedback.highlighted ? " is-highlighted" : ""}`} aria-label={editingId ? "تعديل كوبون" : "إنشاء كوبون"} aria-busy={action === "save"} onSubmit={(event) => void submit(event)}>
      <h3 ref={editFeedback.headingRef} tabIndex={-1}>{editingId ? `تعديل الكوبون: ${form.code}` : "كوبون جديد"}</h3>
      <div className="grid two">
        <div className="field"><label htmlFor="couponManagerCode">كود الكوبون</label><input id="couponManagerCode" value={form.code} disabled={pending} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
        <div className="field"><label htmlFor="couponUsageLimit">حد الاستخدام</label><input id="couponUsageLimit" type="number" min="1" value={form.usageLimit} disabled={pending} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} /></div>
        <div className="field"><label htmlFor="couponType">نوع الخصم</label><select id="couponType" value={form.discountType} disabled={pending} onChange={(e) => setForm({ ...form, discountType: e.target.value as CouponDiscountType })}><option value="fixed">قيمة ثابتة</option><option value="percentage">نسبة مئوية</option></select></div>
        {form.discountType === "fixed"
          ? <div className="field"><label htmlFor="couponFixed">الخصم بالجنيه</label><input id="couponFixed" value={form.fixedEgp} disabled={pending} onChange={(e) => setForm({ ...form, fixedEgp: e.target.value })} /></div>
          : <div className="field"><label htmlFor="couponPercent">النسبة المئوية</label><input id="couponPercent" value={form.percentage} disabled={pending} onChange={(e) => setForm({ ...form, percentage: e.target.value })} /></div>}
        <div className="field"><label htmlFor="couponStart">من تاريخ</label><input id="couponStart" type="date" value={form.startsOn} disabled={pending} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></div>
        <div className="field"><label htmlFor="couponEnd">إلى تاريخ</label><input id="couponEnd" type="date" value={form.endsOn} disabled={pending} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></div>
      </div>
      <fieldset className="offer-scope"><legend>المنتجات المؤهلة للكوبون</legend>{products.map((p) => <label key={p.id}><input type="checkbox" checked={form.productIds.includes(p.id)} disabled={pending} onChange={(e) => toggle("productIds", p.id, e.target.checked)} /> {p.code} — {p.nameAr}</label>)}</fieldset>
      <fieldset className="offer-scope"><legend>التصنيفات المؤهلة للكوبون</legend>{categories.map((c) => <label key={c.id}><input type="checkbox" checked={form.categoryIds.includes(c.id)} disabled={pending} onChange={(e) => toggle("categoryIds", c.id, e.target.checked)} /> {c.nameAr}</label>)}</fieldset>
      <div className="checkboxes"><label><input type="checkbox" checked={form.active} disabled={pending} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> مفعل</label><label><input type="checkbox" checked={form.allowAutomaticOffer} disabled={pending} onChange={(e) => setForm({ ...form, allowAutomaticOffer: e.target.checked })} /> يسمح بالجمع مع عرض تلقائي</label></div>
      <div className="actions"><button disabled={pending} type="submit">{action === "save" ? "جارٍ الحفظ…" : "حفظ الكوبون"}</button>{editingId ? <button type="button" className="secondary" disabled={pending} onClick={() => { if (pendingRef.current) return; setEditingId(null); setForm(emptyForm()); editFeedback.clearHighlight(); }}>إلغاء التعديل</button> : null}</div>
    </form>
    <div className="staff-list">{coupons.map((coupon) => <article className="staff-item" data-testid="coupon-row" key={coupon.id}>
      <h3>{coupon.code}</h3><p>{coupon.discountType === "fixed" ? formatEgpFromPiasters(coupon.fixedDiscountPiasters ?? 0) : `${(coupon.percentageBasisPoints ?? 0) / 100}٪`} — استخدم {coupon.usedCount} من {coupon.usageLimit}</p>
      <p>{coupon.active ? "مفعل" : "متوقف"} — {coupon.allowAutomaticOffer ? "يسمح بالعرض التلقائي" : "منفرد"}</p>
      <button type="button" className="secondary" disabled={pending || listStale} onClick={() => edit(coupon)}>تعديل</button>
    </article>)}</div>
  </section>;
}

function couponRefreshFailureText(caught: unknown) {
  const detail = caught instanceof ApiError ? caught.messageAr : "تعذر تحديث قائمة الكوبونات.";
  return `تعذر تحديث قائمة الكوبونات. ${detail} البيانات الظاهرة قديمة حتى تنجح إعادة التحميل.`;
}
