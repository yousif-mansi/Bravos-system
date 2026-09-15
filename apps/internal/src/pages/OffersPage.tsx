import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  AutomaticOfferDiscountType,
  AutomaticOfferDto,
  AutomaticOfferWriteDto,
  CategoryDto,
  ManagerProductDto,
  WorkspaceDto,
} from "@bravos/contracts";
import {
  ApiError,
  createAutomaticOffer,
  listAutomaticOffers,
  listCategories,
  listProducts,
  updateAutomaticOffer,
} from "../api.ts";
import { egpInputToPiasters, formatEgpFromPiasters } from "../money.ts";
import { signOutPreservingSales } from "../session.ts";

type FormState = {
  nameAr: string;
  discountType: AutomaticOfferDiscountType;
  percentage: string;
  fixedEgp: string;
  startsOn: string;
  endsOn: string;
  active: boolean;
  allowCoupon: boolean;
  productIds: string[];
  categoryIds: string[];
};

function todayInCairo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function emptyForm(): FormState {
  const today = todayInCairo();
  return {
    nameAr: "",
    discountType: "percentage",
    percentage: "10",
    fixedEgp: "0",
    startsOn: today,
    endsOn: today,
    active: false,
    allowCoupon: true,
    productIds: [],
    categoryIds: [],
  };
}

export default function OffersPage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
  const navigate = useNavigate();
  const [offers, setOffers] = useState<AutomaticOfferDto[]>([]);
  const [products, setProducts] = useState<ManagerProductDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const productByCategory = useMemo(() => {
    const groups = new Map<string, ManagerProductDto[]>();
    for (const product of products) {
      const rows = groups.get(product.category.id) ?? [];
      rows.push(product);
      groups.set(product.category.id, rows);
    }
    return groups;
  }, [products]);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setPending(true);
    setError("");
    try {
      const [offerRows, productRows, categoryRows] = await Promise.all([
        listAutomaticOffers(), listProducts(), listCategories(),
      ]);
      setOffers(offerRows);
      setProducts(productRows);
      setCategories(categoryRows);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل العروض.");
    } finally {
      setPending(false);
    }
  }

  async function logout() {
    if (!(await signOutPreservingSales(workspace.staff.id))) return;
    await onChanged(null);
    navigate("/login");
  }

  function toggle(kind: "productIds" | "categoryIds", id: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      [kind]: checked ? [...new Set([...current[kind], id])] : current[kind].filter((value) => value !== id),
    }));
  }

  function edit(offer: AutomaticOfferDto) {
    setEditingId(offer.id);
    setForm({
      nameAr: offer.nameAr,
      discountType: offer.discountType,
      percentage: offer.percentageBasisPoints === null ? "0" : String(offer.percentageBasisPoints / 100),
      fixedEgp: offer.fixedDiscountPiasters === null ? "0" : String(offer.fixedDiscountPiasters / 100),
      startsOn: offer.startsOn,
      endsOn: offer.endsOn,
      active: offer.active,
      allowCoupon: offer.allowCoupon,
      productIds: offer.productIds,
      categoryIds: offer.categoryIds,
    });
    setError("");
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function payload(): AutomaticOfferWriteDto | null {
    const percentage = Number(form.percentage);
    const percentageBasisPoints = Math.round(percentage * 100);
    const fixedDiscountPiasters = egpInputToPiasters(form.fixedEgp);
    if (form.discountType === "percentage" && (!Number.isFinite(percentage) || percentageBasisPoints < 1 || percentageBasisPoints > 10_000)) {
      setError("أدخل نسبة أكبر من صفر وحتى 100٪.");
      return null;
    }
    if (form.discountType === "fixed" && (fixedDiscountPiasters === null || fixedDiscountPiasters < 1)) {
      setError("أدخل قيمة خصم أكبر من صفر.");
      return null;
    }
    return {
      nameAr: form.nameAr,
      discountType: form.discountType,
      percentageBasisPoints: form.discountType === "percentage" ? percentageBasisPoints : null,
      fixedDiscountPiasters: form.discountType === "fixed" ? fixedDiscountPiasters : null,
      startsOn: form.startsOn,
      endsOn: form.endsOn,
      active: form.active,
      allowCoupon: form.allowCoupon,
      productIds: form.productIds,
      categoryIds: form.categoryIds,
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const body = payload();
    if (!body) return;
    setPending(true);
    try {
      if (editingId) {
        await updateAutomaticOffer(editingId, body);
        setNotice("تم تحديث العرض.");
      } else {
        await createAutomaticOffer(body);
        setNotice("تم إنشاء العرض.");
      }
      setEditingId(null);
      setForm(emptyForm());
      setOffers(await listAutomaticOffers());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ العرض.");
    } finally {
      setPending(false);
    }
  }

  async function toggleActive(offer: AutomaticOfferDto) {
    setPending(true);
    setError("");
    try {
      await updateAutomaticOffer(offer.id, {
        nameAr: offer.nameAr,
        discountType: offer.discountType,
        percentageBasisPoints: offer.percentageBasisPoints,
        fixedDiscountPiasters: offer.fixedDiscountPiasters,
        startsOn: offer.startsOn,
        endsOn: offer.endsOn,
        active: !offer.active,
        allowCoupon: offer.allowCoupon,
        productIds: offer.productIds,
        categoryIds: offer.categoryIds,
      });
      setOffers(await listAutomaticOffers());
      setNotice(offer.active ? "تم إيقاف العرض." : "تم تفعيل العرض.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تغيير حالة العرض.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="shell">
      <header className="brand">
        <div><h1>العروض التلقائية</h1><p className="muted">تُطبق أفضل قيمة مؤهلة فقط.</p></div>
        <div className="actions">
          <Link className="button secondary" to="/workspace">مساحة العمل</Link>
          <button className="secondary" type="button" onClick={() => void logout()}>تسجيل الخروج</button>
        </div>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}

      <form className="card" aria-label={editingId ? "تعديل العرض التلقائي" : "إنشاء عرض تلقائي"} onSubmit={(event) => void submit(event)}>
        <h2>{editingId ? "تعديل العرض" : "عرض جديد"}</h2>
        <div className="field"><label htmlFor="offerName">اسم العرض</label><input id="offerName" value={form.nameAr} onChange={(event) => setForm({ ...form, nameAr: event.target.value })} /></div>
        <div className="grid two">
          <div className="field"><label htmlFor="offerType">نوع الخصم</label><select id="offerType" value={form.discountType} onChange={(event) => setForm({ ...form, discountType: event.target.value as AutomaticOfferDiscountType })}><option value="percentage">نسبة مئوية</option><option value="fixed">قيمة ثابتة</option></select></div>
          {form.discountType === "percentage" ? (
            <div className="field"><label htmlFor="offerPercent">النسبة المئوية</label><input id="offerPercent" inputMode="decimal" value={form.percentage} onChange={(event) => setForm({ ...form, percentage: event.target.value })} /></div>
          ) : (
            <div className="field"><label htmlFor="offerFixed">الخصم بالجنيه</label><input id="offerFixed" inputMode="decimal" value={form.fixedEgp} onChange={(event) => setForm({ ...form, fixedEgp: event.target.value })} /></div>
          )}
          <div className="field"><label htmlFor="offerStart">من تاريخ (القاهرة)</label><input id="offerStart" type="date" value={form.startsOn} onChange={(event) => setForm({ ...form, startsOn: event.target.value })} /></div>
          <div className="field"><label htmlFor="offerEnd">إلى تاريخ (القاهرة)</label><input id="offerEnd" type="date" value={form.endsOn} onChange={(event) => setForm({ ...form, endsOn: event.target.value })} /></div>
        </div>
        <fieldset className="offer-scope"><legend>المنتجات المؤهلة</legend>{products.map((product) => <label key={product.id}><input type="checkbox" checked={form.productIds.includes(product.id)} onChange={(event) => toggle("productIds", product.id, event.target.checked)} /> {product.code} — {product.nameAr}</label>)}</fieldset>
        <fieldset className="offer-scope"><legend>التصنيفات المؤهلة</legend>{categories.map((category) => <label key={category.id}><input type="checkbox" checked={form.categoryIds.includes(category.id)} onChange={(event) => toggle("categoryIds", category.id, event.target.checked)} /> {category.nameAr} ({productByCategory.get(category.id)?.length ?? 0} منتج)</label>)}</fieldset>
        <div className="checkboxes">
          <label><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> مفعل</label>
          <label><input type="checkbox" checked={form.allowCoupon} onChange={(event) => setForm({ ...form, allowCoupon: event.target.checked })} /> يسمح بجمع كوبون مؤهل لاحقاً</label>
        </div>
        <div className="actions">
          <button type="submit" disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ العرض"}</button>
          {editingId ? <button className="secondary" type="button" onClick={() => { setEditingId(null); setForm(emptyForm()); }}>إلغاء التعديل</button> : null}
        </div>
      </form>

      <section className="card stacked-form" aria-label="العروض المحفوظة">
        <h2>العروض المحفوظة</h2>
        {offers.length === 0 ? <p className="empty">لا توجد عروض بعد.</p> : (
          <div className="staff-list">{offers.map((offer) => <article className="staff-item" key={offer.id} data-testid="offer-row">
            <h3>{offer.nameAr}</h3>
            <p>{offer.discountType === "percentage" ? `${(offer.percentageBasisPoints ?? 0) / 100}٪` : formatEgpFromPiasters(offer.fixedDiscountPiasters ?? 0)} — {offer.startsOn} إلى {offer.endsOn}</p>
            <p>{offer.active ? "مفعل" : "متوقف"} — {offer.allowCoupon ? "يسمح بالكوبون" : "لا يسمح بالكوبون"}</p>
            <div className="actions"><button type="button" className="secondary" onClick={() => edit(offer)}>تعديل</button><button type="button" className={offer.active ? "danger" : "secondary"} onClick={() => void toggleActive(offer)}>{offer.active ? "إيقاف" : "تفعيل"}</button></div>
          </article>)}</div>
        )}
      </section>
    </main>
  );
}
