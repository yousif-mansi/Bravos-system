import { type FormEvent, useEffect, useMemo, useState } from "react";

import type {
  AutomaticOfferDiscountType,
  AutomaticOfferDto,
  AutomaticOfferWriteDto,
  CategoryDto,
  ManagerProductDto,
  WorkspaceDto,
} from "@bravos/contracts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { useRevealFeedback } from "../ui/useRevealFeedback.ts";
import {
  ApiError,
  createAutomaticOffer,
  listAutomaticOffers,
  listCategories,
  listProducts,
  updateAutomaticOffer,
} from "../api.ts";
import { egpInputToPiasters, formatEgpFromPiasters } from "../money.ts";

import { CouponManager } from "./CouponManager.tsx";

type FormState = {
  nameAr: string;
  discountType: AutomaticOfferDiscountType;
  percentage: string;
  fixedEgp: string;
  bundlePriceEgp: string;
  bundleItems: Array<{ variantId: string; requiredQuantity: string }>;
  buyQuantity: string;
  rewardQuantity: string;
  rewardPercentage: string;
  buyProductIds: string[];
  buyCategoryIds: string[];
  rewardProductIds: string[];
  rewardCategoryIds: string[];
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
    bundlePriceEgp: "0",
    bundleItems: [{ variantId: "", requiredQuantity: "1" }],
    buyQuantity: "2",
    rewardQuantity: "1",
    rewardPercentage: "100",
    buyProductIds: [],
    buyCategoryIds: [],
    rewardProductIds: [],
    rewardCategoryIds: [],
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
  const [offers, setOffers] = useState<AutomaticOfferDto[]>([]);
  const [products, setProducts] = useState<ManagerProductDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const editFeedback = useRevealFeedback<HTMLFormElement>();

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

  function toggle(
    kind: "productIds" | "categoryIds" | "buyProductIds" | "buyCategoryIds" | "rewardProductIds" | "rewardCategoryIds",
    id: string,
    checked: boolean,
  ) {
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
      bundlePriceEgp: offer.bundlePricePiasters === null ? "0" : String(offer.bundlePricePiasters / 100),
      bundleItems: offer.bundleItems.length > 0
        ? offer.bundleItems.map((item) => ({ variantId: item.variantId, requiredQuantity: String(item.requiredQuantity) }))
        : [{ variantId: "", requiredQuantity: "1" }],
      buyQuantity: String(offer.buyQuantity ?? 2),
      rewardQuantity: String(offer.rewardQuantity ?? 1),
      rewardPercentage: String((offer.rewardPercentageBasisPoints ?? 10_000) / 100),
      buyProductIds: offer.buyProductIds,
      buyCategoryIds: offer.buyCategoryIds,
      rewardProductIds: offer.rewardProductIds,
      rewardCategoryIds: offer.rewardCategoryIds,
      startsOn: offer.startsOn,
      endsOn: offer.endsOn,
      active: offer.active,
      allowCoupon: offer.allowCoupon,
      productIds: offer.productIds,
      categoryIds: offer.categoryIds,
    });
    setError("");
    setNotice("");
    editFeedback.reveal();
  }

  function payload(): AutomaticOfferWriteDto | null {
    const percentage = Number(form.percentage);
    const percentageBasisPoints = Math.round(percentage * 100);
    const fixedDiscountPiasters = egpInputToPiasters(form.fixedEgp);
    const bundlePricePiasters = egpInputToPiasters(form.bundlePriceEgp);
    const buyQuantity = Number(form.buyQuantity);
    const rewardQuantity = Number(form.rewardQuantity);
    const rewardPercentageBasisPoints = Math.round(Number(form.rewardPercentage) * 100);
    if (form.discountType === "percentage" && (!Number.isFinite(percentage) || percentageBasisPoints < 1 || percentageBasisPoints > 10_000)) {
      setError("أدخل نسبة أكبر من صفر وحتى 100٪.");
      return null;
    }
    if (form.discountType === "fixed" && (fixedDiscountPiasters === null || fixedDiscountPiasters < 1)) {
      setError("أدخل قيمة خصم أكبر من صفر.");
      return null;
    }
    if (form.discountType === "fixed_bundle" && (bundlePricePiasters === null || bundlePricePiasters < 0)) {
      setError("أدخل سعراً صحيحاً للحزمة، ويمكن أن يكون صفراً.");
      return null;
    }
    const bundleItems = form.bundleItems.map((item) => ({
      variantId: item.variantId,
      requiredQuantity: Number(item.requiredQuantity),
    }));
    if (form.discountType === "fixed_bundle" && (bundleItems.some((item) =>
      !item.variantId || !Number.isSafeInteger(item.requiredQuantity) || item.requiredQuantity < 1)
      || new Set(bundleItems.map((item) => item.variantId)).size !== bundleItems.length)) {
      setError("اختر متغيرات الحزمة مرة واحدة وحدد كمية صحيحة لكل منها.");
      return null;
    }
    if (form.discountType === "buy_x_get_y" && (!Number.isSafeInteger(buyQuantity) || buyQuantity < 1
      || !Number.isSafeInteger(rewardQuantity) || rewardQuantity < 1
      || rewardPercentageBasisPoints < 1 || rewardPercentageBasisPoints > 10_000)) {
      setError("أدخل كميات صحيحة ونسبة خصم للمكافأة من 0.01٪ إلى 100٪.");
      return null;
    }
    return {
      nameAr: form.nameAr,
      discountType: form.discountType,
      percentageBasisPoints: form.discountType === "percentage" ? percentageBasisPoints : null,
      fixedDiscountPiasters: form.discountType === "fixed" ? fixedDiscountPiasters : null,
      bundlePricePiasters: form.discountType === "fixed_bundle" ? bundlePricePiasters : null,
      bundleItems: form.discountType === "fixed_bundle" ? bundleItems : [],
      buyQuantity: form.discountType === "buy_x_get_y" ? buyQuantity : null,
      rewardQuantity: form.discountType === "buy_x_get_y" ? rewardQuantity : null,
      rewardPercentageBasisPoints: form.discountType === "buy_x_get_y" ? rewardPercentageBasisPoints : null,
      buyProductIds: form.discountType === "buy_x_get_y" ? form.buyProductIds : [],
      buyCategoryIds: form.discountType === "buy_x_get_y" ? form.buyCategoryIds : [],
      rewardProductIds: form.discountType === "buy_x_get_y" ? form.rewardProductIds : [],
      rewardCategoryIds: form.discountType === "buy_x_get_y" ? form.rewardCategoryIds : [],
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
      editFeedback.clearHighlight();
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
        bundlePricePiasters: offer.bundlePricePiasters,
        bundleItems: offer.bundleItems,
        buyQuantity: offer.buyQuantity,
        rewardQuantity: offer.rewardQuantity,
        rewardPercentageBasisPoints: offer.rewardPercentageBasisPoints,
        buyProductIds: offer.buyProductIds,
        buyCategoryIds: offer.buyCategoryIds,
        rewardProductIds: offer.rewardProductIds,
        rewardCategoryIds: offer.rewardCategoryIds,
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
      <header className="page-hero">
        <h1>العروض التلقائية</h1>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}

      <form ref={editFeedback.regionRef} className={`card reveal-feedback${editFeedback.highlighted ? " is-highlighted" : ""}`} aria-label={editingId ? "تعديل العرض التلقائي" : "إنشاء عرض تلقائي"} onSubmit={(event) => void submit(event)}>
        <h2 ref={editFeedback.headingRef} tabIndex={-1}>{editingId ? `تعديل العرض: ${form.nameAr}` : "عرض جديد"}</h2>
        <div className="field"><label htmlFor="offerName">اسم العرض</label><input id="offerName" value={form.nameAr} onChange={(event) => setForm({ ...form, nameAr: event.target.value })} /></div>
        <div className="grid two">
          <div className="field"><label htmlFor="offerType">نوع الخصم</label><select id="offerType" value={form.discountType} onChange={(event) => setForm({ ...form, discountType: event.target.value as AutomaticOfferDiscountType })}><option value="percentage">نسبة مئوية</option><option value="fixed">قيمة ثابتة</option><option value="fixed_bundle">حزمة بسعر محدد</option><option value="buy_x_get_y">اشترِ وخذ مكافأة</option></select></div>
          {form.discountType === "percentage" ? (
            <div className="field"><label htmlFor="offerPercent">النسبة المئوية</label><input id="offerPercent" inputMode="decimal" value={form.percentage} onChange={(event) => setForm({ ...form, percentage: event.target.value })} /></div>
          ) : form.discountType === "fixed" ? (
            <div className="field"><label htmlFor="offerFixed">الخصم بالجنيه</label><input id="offerFixed" inputMode="decimal" value={form.fixedEgp} onChange={(event) => setForm({ ...form, fixedEgp: event.target.value })} /></div>
          ) : null}
          <div className="field"><label htmlFor="offerStart">من تاريخ</label><input id="offerStart" type="date" value={form.startsOn} onChange={(event) => setForm({ ...form, startsOn: event.target.value })} /></div>
          <div className="field"><label htmlFor="offerEnd">إلى تاريخ</label><input id="offerEnd" type="date" value={form.endsOn} onChange={(event) => setForm({ ...form, endsOn: event.target.value })} /></div>
        </div>
        {form.discountType === "percentage" || form.discountType === "fixed" ? <>
          <fieldset className="offer-scope"><legend>المنتجات المؤهلة</legend>{products.map((product) => <label key={product.id}><input type="checkbox" checked={form.productIds.includes(product.id)} onChange={(event) => toggle("productIds", product.id, event.target.checked)} /> {product.code} — {product.nameAr}</label>)}</fieldset>
          <fieldset className="offer-scope"><legend>التصنيفات المؤهلة</legend>{categories.map((category) => <label key={category.id}><input type="checkbox" checked={form.categoryIds.includes(category.id)} onChange={(event) => toggle("categoryIds", category.id, event.target.checked)} /> {category.nameAr} ({productByCategory.get(category.id)?.length ?? 0} منتج)</label>)}</fieldset>
        </> : null}

        {form.discountType === "fixed_bundle" ? <section className="stacked-form" aria-label="محتويات الحزمة">
          <div className="field"><label htmlFor="bundlePrice">سعر الحزمة بالجنيه</label><input id="bundlePrice" inputMode="decimal" value={form.bundlePriceEgp} onChange={(event) => setForm({ ...form, bundlePriceEgp: event.target.value })} /></div>
          <h3>المتغيرات والكميات المطلوبة</h3>
          {form.bundleItems.map((item, index) => <div className="grid two" key={`${index}-${item.variantId}`} data-testid="bundle-item-row">
            <div className="field"><label htmlFor={`bundleVariant${index}`}>المتغير</label><select id={`bundleVariant${index}`} value={item.variantId} onChange={(event) => setForm((current) => ({ ...current, bundleItems: current.bundleItems.map((row, rowIndex) => rowIndex === index ? { ...row, variantId: event.target.value } : row) }))}><option value="">اختر المنتج والمقاس واللون</option>{products.flatMap((product) => product.variants.map((variant) => <option key={variant.id} value={variant.id} disabled={form.bundleItems.some((row, rowIndex) => rowIndex !== index && row.variantId === variant.id)}>{product.code} — {product.nameAr} — {variant.size.nameAr} — {variant.color.nameAr}</option>))}</select></div>
            <div className="field"><label htmlFor={`bundleQuantity${index}`}>الكمية</label><input id={`bundleQuantity${index}`} inputMode="numeric" value={item.requiredQuantity} onChange={(event) => setForm((current) => ({ ...current, bundleItems: current.bundleItems.map((row, rowIndex) => rowIndex === index ? { ...row, requiredQuantity: event.target.value } : row) }))} /></div>
            {form.bundleItems.length > 1 ? <button className="danger" type="button" onClick={() => setForm((current) => ({ ...current, bundleItems: current.bundleItems.filter((_, rowIndex) => rowIndex !== index) }))}>حذف المتغير</button> : null}
          </div>)}
          <button className="secondary" type="button" onClick={() => setForm((current) => ({ ...current, bundleItems: [...current.bundleItems, { variantId: "", requiredQuantity: "1" }] }))}>إضافة متغير للحزمة</button>
        </section> : null}

        {form.discountType === "buy_x_get_y" ? <section className="stacked-form" aria-label="قواعد مكافأة الشراء">
          <div className="grid two">
            <div className="field"><label htmlFor="buyQuantity">عدد وحدات الشراء</label><input id="buyQuantity" inputMode="numeric" value={form.buyQuantity} onChange={(event) => setForm({ ...form, buyQuantity: event.target.value })} /></div>
            <div className="field"><label htmlFor="rewardQuantity">عدد وحدات المكافأة</label><input id="rewardQuantity" inputMode="numeric" value={form.rewardQuantity} onChange={(event) => setForm({ ...form, rewardQuantity: event.target.value })} /></div>
            <div className="field"><label htmlFor="rewardPercentage">نسبة خصم المكافأة</label><input id="rewardPercentage" inputMode="decimal" value={form.rewardPercentage} onChange={(event) => setForm({ ...form, rewardPercentage: event.target.value })} /></div>
          </div>
          <p className="muted">100٪ تعني أن وحدة المكافأة مجانية. تُختار أرخص مكافأة ممكنة مع إبقاء وحدات الشراء منفصلة.</p>
          <fieldset className="offer-scope"><legend>منتجات الشراء</legend>{products.map((product) => <label key={product.id}><input type="checkbox" checked={form.buyProductIds.includes(product.id)} onChange={(event) => toggle("buyProductIds", product.id, event.target.checked)} /> {product.code} — {product.nameAr}</label>)}</fieldset>
          <fieldset className="offer-scope"><legend>تصنيفات الشراء</legend>{categories.map((category) => <label key={category.id}><input type="checkbox" checked={form.buyCategoryIds.includes(category.id)} onChange={(event) => toggle("buyCategoryIds", category.id, event.target.checked)} /> {category.nameAr}</label>)}</fieldset>
          <fieldset className="offer-scope"><legend>منتجات المكافأة</legend>{products.map((product) => <label key={product.id}><input type="checkbox" checked={form.rewardProductIds.includes(product.id)} onChange={(event) => toggle("rewardProductIds", product.id, event.target.checked)} /> {product.code} — {product.nameAr}</label>)}</fieldset>
          <fieldset className="offer-scope"><legend>تصنيفات المكافأة</legend>{categories.map((category) => <label key={category.id}><input type="checkbox" checked={form.rewardCategoryIds.includes(category.id)} onChange={(event) => toggle("rewardCategoryIds", category.id, event.target.checked)} /> {category.nameAr}</label>)}</fieldset>
        </section> : null}
        <div className="checkboxes">
          <label><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> مفعل</label>
          <label><input type="checkbox" checked={form.allowCoupon} onChange={(event) => setForm({ ...form, allowCoupon: event.target.checked })} /> يسمح بجمع كوبون مؤهل لاحقاً</label>
        </div>
        <div className="actions">
          <button type="submit" disabled={pending}>{pending ? "جارٍ الحفظ…" : "حفظ العرض"}</button>
          {editingId ? <button className="secondary" type="button" onClick={() => { setEditingId(null); setForm(emptyForm()); editFeedback.clearHighlight(); }}>إلغاء التعديل</button> : null}
        </div>
      </form>

      <section className="card stacked-form" aria-label="العروض المحفوظة">
        <h2>العروض المحفوظة</h2>
        {offers.length === 0 ? <EmptyState title="لسه مفيش عروض" message="أنشئ أول عرض من النموذج فوق." /> : (
          <div className="staff-list">{offers.map((offer) => <article className="staff-item" key={offer.id} data-testid="offer-row">
            <h3>{offer.nameAr}</h3>
            <p>{offerSummary(offer)} — {offer.startsOn} إلى {offer.endsOn}</p>
            <p>{offer.active ? "مفعل" : "متوقف"} — {offer.allowCoupon ? "يسمح بالكوبون" : "لا يسمح بالكوبون"}</p>
            <div className="actions"><button type="button" className="secondary" onClick={() => edit(offer)}>تعديل</button><button type="button" className={offer.active ? "danger" : "secondary"} onClick={() => void toggleActive(offer)}>{offer.active ? "إيقاف" : "تفعيل"}</button></div>
          </article>)}</div>
        )}
      </section>
      <CouponManager products={products} categories={categories} />
    </main>
  );
}

function offerSummary(offer: AutomaticOfferDto): string {
  if (offer.discountType === "percentage") return `${(offer.percentageBasisPoints ?? 0) / 100}٪`;
  if (offer.discountType === "fixed") return formatEgpFromPiasters(offer.fixedDiscountPiasters ?? 0);
  if (offer.discountType === "fixed_bundle") {
    return `حزمة من ${offer.bundleItems.length} متغير — ${formatEgpFromPiasters(offer.bundlePricePiasters ?? 0)}`;
  }
  return `اشترِ ${offer.buyQuantity ?? 0} وخذ ${offer.rewardQuantity ?? 0} بخصم ${(offer.rewardPercentageBasisPoints ?? 0) / 100}٪`;
}
