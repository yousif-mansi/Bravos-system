import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";

import type {
  CategoryDto,
  ColorDto,
  ManagerProductDto,
  PublicationStatus,
  SizeDto,
  WorkspaceDto,
} from "@bravos/contracts";
import { OPERATIONAL_COLOR_ID, OPERATIONAL_SIZE_ID } from "@bravos/contracts";
import {
  ApiError,
  createCategory,
  createColor,
  createSize,
  listCategories,
  listColors,
  listProducts,
  listSizes,
  updateCategory,
  updateColor,
  updateProduct,
  updateSize,
  uploadProductImage,
} from "../api.ts";
import { egpInputToPiasters, formatEgpFromPiasters, piastersToEgpInput } from "../money.ts";
import { ProductLabelAction } from "../labels/ProductLabelAction.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { BusinessTabs, Modal } from "../ui/BusinessUi.tsx";
import "./CatalogPage.css";
import { useRevealFeedback } from "../ui/useRevealFeedback.ts";


type VariantDraft = {
  key: string;
  savedId: string | null;
  sizeId: string;
  colorId: string;
  onlineVisible: boolean;
};

type ProductDraft = {
  editRevision: number | null;
  code: string;
  nameAr: string;
  descriptionAr: string;
  categoryId: string;
  defaultEgp: string;
  minimumEgp: string;
  publication: PublicationStatus;
  imageRefs: string[];
  sizeGuideAr: string;
  variants: VariantDraft[];
};

function emptyProduct(): ProductDraft {
  return {
    editRevision: null,
    code: "",
    nameAr: "",
    descriptionAr: "",
    categoryId: "",
    defaultEgp: "",
    minimumEgp: "",
    publication: "hidden",
    imageRefs: [],
    sizeGuideAr: "",
    variants: [],
  };
}

type CategoryNode = { id: string; nameAr: string; parentId: string | null };

function categoryPath(categories: readonly CategoryNode[], categoryId: string): string {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(categoryId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.push(current.nameAr);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.reverse().join(" / ");
}

function categoryInBranch(categories: readonly CategoryNode[], productCategoryId: string, selectedCategoryId: string): boolean {
  if (!selectedCategoryId) return true;
  const byId = new Map(categories.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let current = byId.get(productCategoryId);
  while (current && !seen.has(current.id)) {
    if (current.id === selectedCategoryId) return true;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}

function matchesNameOrSku(product: { code: string; nameAr: string }, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return product.code.toLocaleLowerCase().includes(needle) || product.nameAr.toLocaleLowerCase().includes(needle);
}

export default function CatalogPage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [sizes, setSizes] = useState<SizeDto[]>([]);
  const [colors, setColors] = useState<ColorDto[]>([]);
  const [products, setProducts] = useState<ManagerProductDto[]>([]);
  const [categoryName, setCategoryName] = useState("");
  const [parentId, setParentId] = useState("");
  const [sizeName, setSizeName] = useState("");
  const [colorName, setColorName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [browseCategoryId, setBrowseCategoryId] = useState("");
  const [browseQuery, setBrowseQuery] = useState("");
  const [product, setProduct] = useState<ProductDraft>(emptyProduct);
  const [pending, setPending] = useState("");
  const [productPending, setProductPending] = useState<"" | "media" | "product">("");
  const [editorTab, setEditorTab] = useState("basic");
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const savedDraft = useRef("");
  const productDraftVersion = useRef(0);
  const productFeedback = useRevealFeedback<HTMLFormElement>();

  function replaceProductDraft(next: ProductDraft) {
    productDraftVersion.current += 1;
    setProduct(next);
  }

  async function refresh() {
    const [nextCategories, nextSizes, nextColors, nextProducts] = await Promise.all([
      listCategories(),
      listSizes(),
      listColors(),
      listProducts(),
    ]);
    setCategories(nextCategories);
    setSizes(nextSizes);
    setColors(nextColors);
    setProducts(nextProducts);
  }

  useEffect(() => {
    void refresh().catch((caught: unknown) => {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل المنتجات.");
    }).finally(() => setLoading(false));
  }, []);

  async function onCreateCategory(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setPending("category");
    try {
      await createCategory({
        nameAr: categoryName,
        ...(parentId ? { parentId } : {}),
      });
      setCategoryName("");
      setParentId("");
      setNotice("تم حفظ التصنيف.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ التصنيف.");
    } finally {
      setPending("");
    }
  }

  async function onRenameCategory(id: string, nameAr: string) {
    setError("");
    setNotice("");
    setPending(`category-${id}`);
    try {
      await updateCategory(id, nameAr);
      setNotice("تم تحديث التصنيف.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحديث التصنيف.");
    } finally {
      setPending("");
    }
  }

  async function onCreateSize(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setPending("size");
    try {
      await createSize(sizeName);
      setSizeName("");
      setNotice("تم حفظ المقاس.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ المقاس.");
    } finally {
      setPending("");
    }
  }

  async function onRenameSize(id: string, nameAr: string) {
    setError("");
    setNotice("");
    setPending(`size-${id}`);
    try {
      await updateSize(id, nameAr);
      setNotice("تم تحديث المقاس.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحديث المقاس.");
    } finally {
      setPending("");
    }
  }

  async function onCreateColor(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setPending("color");
    try {
      await createColor(colorName);
      setColorName("");
      setNotice("تم حفظ اللون.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ اللون.");
    } finally {
      setPending("");
    }
  }

  async function onRenameColor(id: string, nameAr: string) {
    setError("");
    setNotice("");
    setPending(`color-${id}`);
    try {
      await updateColor(id, nameAr);
      setNotice("تم تحديث اللون.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحديث اللون.");
    } finally {
      setPending("");
    }
  }

  async function onSaveProduct(event: FormEvent) {
    event.preventDefault();
    if (productPending || !editingId) {
      return;
    }
    const expectedRevision = product.editRevision;
    if (expectedRevision === null) {
      setError("أعد اختيار المنتج قبل حفظ التعديل.");
      return;
    }
    setError("");
    setNotice("");
    const defaultSellingPricePiasters = egpInputToPiasters(product.defaultEgp);
    if (defaultSellingPricePiasters === null) {
      setError("سعر البيع غير صالح.");
      return;
    }
    const minimumText = product.minimumEgp.trim();
    const minimumSellingPricePiasters = minimumText ? egpInputToPiasters(minimumText) : null;
    if (minimumText && minimumSellingPricePiasters === null) {
      setError("الحد الأدنى للبيع غير صالح.");
      return;
    }
    if (minimumSellingPricePiasters !== null && minimumSellingPricePiasters > defaultSellingPricePiasters) {
      setError("الحد الأدنى لا يمكن أن يتجاوز سعر البيع.");
      return;
    }
    const variants = [];
    for (const draft of product.variants) {
      if (!draft.sizeId || !draft.colorId || draft.sizeId === OPERATIONAL_SIZE_ID || draft.colorId === OPERATIONAL_COLOR_ID) {
        setError("يجب تحديد مقاس ولون للموقع لكل خيار.");
        return;
      }
      variants.push({
        sizeId: draft.sizeId,
        colorId: draft.colorId,
        onlineVisible: draft.onlineVisible,
        sellingPricePiastersOverride: null,
      });
    }
    setProductPending("product");
    try {
      const payload = {
        expectedRevision,
        expectedVariantIds: product.variants.flatMap((variant) => variant.savedId ? [variant.savedId] : []),
        code: product.code,
        nameAr: product.nameAr,
        descriptionAr: product.descriptionAr,
        categoryId: product.categoryId,
        defaultSellingPricePiasters,
        minimumSellingPricePiasters,
        publication: product.publication,
        imageRefs: product.imageRefs,
        sizeGuideAr: product.sizeGuideAr.trim() || null,
        variants,
      };
      await updateProduct(editingId, payload);
      setNotice("تم تحديث المنتج.");
      setEditingId(null);
      replaceProductDraft(emptyProduct());
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ المنتج.");
    } finally {
      setProductPending("");
    }
  }

  function startEdit(item: ManagerProductDto) {
    if (editingId === item.id) return;
    if (editingId && JSON.stringify(product) !== savedDraft.current && !window.confirm("لديك تغييرات غير محفوظة. هل تريد تركها واختيار منتج آخر؟")) return;
    setError("");
    setNotice("");
    setEditingId(item.id);
    const nextDraft: ProductDraft = {
      editRevision: item.editRevision,
      code: item.code,
      nameAr: item.nameAr,
      descriptionAr: item.descriptionAr,
      categoryId: item.category.id,
      defaultEgp: piastersToEgpInput(item.defaultSellingPricePiasters),
      minimumEgp: item.minimumSellingPricePiasters === null ? "" : piastersToEgpInput(item.minimumSellingPricePiasters),
      publication: item.publication,
      imageRefs: item.imageRefs,
      sizeGuideAr: item.sizeGuideAr ?? "",
      variants: item.variants
        .filter((variant) => variant.size.id !== OPERATIONAL_SIZE_ID && variant.color.id !== OPERATIONAL_COLOR_ID)
        .map((variant) => ({
          key: variant.id,
          savedId: variant.id,
          sizeId: variant.size.id,
          colorId: variant.color.id,
          onlineVisible: variant.onlineVisible,
        })),
    };
    savedDraft.current = JSON.stringify(nextDraft);
    replaceProductDraft(nextDraft);
    setEditorTab("basic");
    productFeedback.reveal();
  }

  async function onUploadImages(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) {
      return;
    }
    if (productPending) {
      return;
    }
    if (product.imageRefs.length + files.length > 20) {
      setError("يمكن إضافة 20 صورة كحد أقصى للمنتج.");
      return;
    }
    setError("");
    setNotice("");
    setProductPending("media");
    const version = productDraftVersion.current;
    let uploadedCount = 0;
    try {
      for (const file of files) {
        try {
          const uploaded = await uploadProductImage(file);
          if (productDraftVersion.current !== version) {
            return;
          }
          uploadedCount += 1;
          setProduct((current) => (
            productDraftVersion.current === version
              ? { ...current, imageRefs: [...current.imageRefs, uploaded.ref] }
              : current
          ));
        } catch (caught) {
          if (productDraftVersion.current !== version) {
            return;
          }
          setError(caught instanceof ApiError ? caught.messageAr : "تعذر رفع الصورة.");
          if (uploadedCount > 0) {
            setNotice(`تم رفع ${uploadedCount} من ${files.length} صورة وإضافتها إلى المسودة. احفظ المنتج للاحتفاظ بما تم رفعه.`);
          }
          return;
        }
      }
      if (productDraftVersion.current === version) {
        setNotice(uploadedCount === 1 ? "تم رفع الصورة. احفظ المنتج لتثبيتها." : `تم رفع ${uploadedCount} صور. احفظ المنتج لتثبيتها.`);
      }
    } finally {
      setProductPending("");
    }
  }

  const roots = categories.filter((item) => item.parentId === null);
  const matchedProducts = products.filter((item) => categoryInBranch(categories, item.category.id, browseCategoryId) && matchesNameOrSku(item, browseQuery));
  const listedProducts = matchedProducts;
  const browseActive = browseCategoryId !== "" || browseQuery.trim() !== "";
  const categoryOptions = categories
    .map((item) => ({ id: item.id, label: categoryPath(categories, item.id) || item.nameAr }))
    .sort((left, right) => left.label.localeCompare(right.label, "ar"));

  return (
    <main className="shell catalog-page business-page">
      <header className="page-hero business-page-header"><h1>إدارة المنتجات</h1><button type="button" className="secondary" onClick={() => setTaxonomyOpen(true)}>إدارة التصنيفات والمقاسات والألوان</button></header>
      {error ? <div className="error point-feedback" role="alert">{error} <button type="button" className="secondary" onClick={() => { setLoading(true); setError(""); void refresh().catch((caught: unknown) => setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل المنتجات.")).finally(() => setLoading(false)); }}>إعادة تحميل البيانات</button></div> : null}
      {notice ? <div className="notice point-feedback" role="status">{notice}</div> : null}
      <div className="catalog-master-detail">
      <section className="card catalog-browse business-list-panel">
        <h2>المنتجات</h2>
        <p id="catalog-browse-count" data-testid="catalog-browse-count">المطابق: {matchedProducts.length} من {products.length}</p>
        {(
          <div className="merchandise-filters" role="group" aria-label="تنظيم المنتجات" data-testid="catalog-browse-filters">
            <div className="field">
              <label htmlFor="catalog-browse-category">الفئة</label>
              <select
                id="catalog-browse-category"
                value={browseCategoryId}
                aria-describedby="catalog-browse-count"
                onChange={(event) => setBrowseCategoryId(event.target.value)}
              >
                <option value="">كل الفئات</option>
                {categoryOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="catalog-browse-query">الاسم أو رمز SKU</label>
              <input
                id="catalog-browse-query"
                value={browseQuery}
                autoComplete="off"
                placeholder="اسم أو رمز"
                aria-describedby="catalog-browse-count"
                onChange={(event) => setBrowseQuery(event.target.value)}
              />
            </div>
            <div className="merchandise-filter-meta">
              {browseActive ? <button type="button" onClick={() => { setBrowseCategoryId(""); setBrowseQuery(""); }}>مسح التصفية</button> : null}
            </div>
          </div>
        )}
        {loading ? <p role="status">جارٍ تحميل المنتجات…</p> : products.length === 0 ? (
          <EmptyState title="لسه مفيش منتجات" message="ابدأ بإضافة أول صنف من صفحة استلام المخزون." />
        ) : listedProducts.length === 0 ? (
          <p data-testid="catalog-browse-empty">لا توجد منتجات مطابقة.</p>
        ) : (
          <div className="staff-list">
            {listedProducts.map((item) => (
              <article className={`staff-item catalog-list-item${editingId === item.id ? " is-selected" : ""}`} key={item.id}>
                <button type="button" className="catalog-select-product" disabled={Boolean(productPending)} onClick={() => startEdit(item)} aria-pressed={editingId === item.id}><strong>{item.nameAr}</strong></button>
                <p className="muted">رمز المنتج: {item.code} — {item.category.nameAr}</p>
                <p>حالة الموقع: {publicationLabel(item.publication)} · {formatEgpFromPiasters(item.defaultSellingPricePiasters)}</p>
                <div className="form-actions">
                  <ProductLabelAction
                    product={{ id: item.id, code: item.code, nameAr: item.nameAr }}
                    disabled={Boolean(productPending)}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <div className="catalog-editor">
          {editingId ? <form
          ref={productFeedback.regionRef}
          className={`card catalog-product-form reveal-feedback${productFeedback.highlighted ? " is-highlighted" : ""}`}
          aria-busy={Boolean(productPending)}
          aria-label="تعديل منتج"
          noValidate
          onSubmit={(event) => {
            const form = event.currentTarget;
            if (!form.checkValidity()) {
              event.preventDefault();
              setEditorTab("basic");
              requestAnimationFrame(() => form.reportValidity());
              return;
            }
            void onSaveProduct(event);
          }}
        >
          <div className="catalog-editor-heading"><h2 ref={productFeedback.headingRef} tabIndex={-1}>{product.nameAr}</h2>
          <span>{JSON.stringify(product) !== savedDraft.current ? "تغييرات غير محفوظة" : ""}</span></div>
          <BusinessTabs id="catalog-editor-tabs" label="بيانات المنتج" value={editorTab} onChange={setEditorTab} items={[{ id: "basic", label: "البيانات الأساسية" }, { id: "online", label: "المتجر الإلكتروني" }, { id: "options", label: "المقاسات والألوان" }]} />
          <div role="tabpanel" id="catalog-editor-tabs-panel-basic" aria-labelledby="catalog-editor-tabs-tab-basic" hidden={editorTab !== "basic"} className="catalog-fields">
          <div className="field">
            <label htmlFor="productCode">رمز المنتج</label>
            <input id="productCode" value={product.code} readOnly />
          </div>
          <div className="field">
            <label htmlFor="productName">اسم المنتج</label>
            <input id="productName" value={product.nameAr} onChange={(event) => setProduct({ ...product, nameAr: event.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="productCategory">التصنيف</label>
            <select id="productCategory" value={product.categoryId} onChange={(event) => setProduct({ ...product, categoryId: event.target.value })} required>
              <option value="">اختر تصنيفاً</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {categoryPath(categories, item.id) || item.nameAr}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="productPrice">سعر البيع بالجنيه</label>
            <input id="productPrice" inputMode="decimal" value={product.defaultEgp} onChange={(event) => setProduct({ ...product, defaultEgp: event.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="productMinimum">الحد الأدنى للبيع بالجنيه (اختياري)</label>
            <input id="productMinimum" inputMode="decimal" value={product.minimumEgp} onChange={(event) => setProduct({ ...product, minimumEgp: event.target.value })} />
          </div>
          <button type="button" className="secondary" onClick={() => setTaxonomyOpen(true)}>إضافة أو تعديل تصنيف</button>
          </div>
          <div role="tabpanel" id="catalog-editor-tabs-panel-online" aria-labelledby="catalog-editor-tabs-tab-online" hidden={editorTab !== "online"} className="catalog-fields catalog-online-fields">
          <div className="field catalog-description">
            <label htmlFor="productDescription">الوصف</label>
            <textarea id="productDescription" value={product.descriptionAr} onChange={(event) => setProduct({ ...product, descriptionAr: event.target.value })} rows={3} />
          </div>
          <div className="field catalog-publication">
            <label htmlFor="productPublication">حالة الموقع</label>
            <select
              id="productPublication"
              value={product.publication}
              onChange={(event) => setProduct({ ...product, publication: event.target.value as PublicationStatus })}
            >
              <option value="hidden">مخفي</option>
              <option value="coming_soon">قريباً</option>
              <option value="available">متاح</option>
            </select>
          </div>
          <div className="field catalog-size-guide">
            <label htmlFor="productSizeGuide">دليل المقاسات (اختياري)</label>
            <textarea
              id="productSizeGuide"
              value={product.sizeGuideAr}
              onChange={(event) => setProduct({ ...product, sizeGuideAr: event.target.value })}
              rows={3}
              maxLength={4000}
              placeholder="مثال: المقاس L — عرض الصدر 52 سم"
            />
          </div>
          <fieldset className="grant-editor catalog-images">
            <legend>صور المنتج</legend>
            <div className="field">
              <label htmlFor="productImages">رفع صور JPG أو PNG أو WebP (5 ميجابايت للصورة)</label>
              <input
                id="productImages"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={Boolean(productPending) || product.imageRefs.length >= 20}
                onChange={(event) => void onUploadImages(event)}
              />
            </div>
            {productPending === "media" ? <p role="status">لحظات…</p> : null}
            {product.imageRefs.length > 0 ? (
              <div className="media-grid" aria-label="صور المنتج الحالية">
                {product.imageRefs.map((ref, index) => (
                  <figure className="media-item" key={ref}>
                    <img src={`/api/internal/catalog/media/${ref}`} alt={`صورة المنتج ${index + 1}`} />
                    {index > 0 ? <button type="button" className="secondary" disabled={Boolean(productPending)} onClick={() => setProduct((current) => ({ ...current, imageRefs: [ref, ...current.imageRefs.filter((item) => item !== ref)] }))}>تعيين صورة رئيسية</button> : <span>الصورة الرئيسية</span>}
                    <button
                      type="button"
                      className="danger"
                      disabled={Boolean(productPending)}
                      onClick={() => setProduct((current) => ({
                        ...current,
                        imageRefs: current.imageRefs.filter((item) => item !== ref),
                      }))}
                    >
                      إزالة الصورة
                    </button>
                  </figure>
                ))}
              </div>
            ) : <p className="muted">لا توجد صور مضافة.</p>}
          </fieldset>
          </div>
          <div role="tabpanel" id="catalog-editor-tabs-panel-options" aria-labelledby="catalog-editor-tabs-tab-options" hidden={editorTab !== "options"}>
          <button type="button" className="secondary" onClick={() => setTaxonomyOpen(true)}>إضافة أو تعديل مقاس أو لون</button>
          <fieldset className="grant-editor catalog-options">
            <legend>خيارات الموقع</legend>
            <details className="business-disclosure" open>
              <summary>تحديد جماعي حسب المقاس أو اللون</summary>
              <p className="catalog-bulk-warning">يغيّر كل التركيبات المسجلة لهذا المقاس أو اللون</p>
            <div className="grid two">
              <fieldset>
                <legend>المقاسات المعروضة على الموقع</legend>
                {[...new Set(product.variants.map((variant) => variant.sizeId))].map((sizeId) => {
                  const inSize = product.variants.filter((variant) => variant.sizeId === sizeId);
                  return <label key={sizeId}>
                    <input
                      type="checkbox"
                      checked={inSize.every((variant) => variant.onlineVisible)}
                      onChange={(event) => setProduct((current) => ({ ...current, variants: current.variants.map((variant) => variant.sizeId === sizeId ? { ...variant, onlineVisible: event.target.checked } : variant) }))}
                    /> {sizes.find((item) => item.id === sizeId)?.nameAr ?? ""} ({inSize.filter((variant) => variant.onlineVisible).length}/{inSize.length})
                  </label>;
                })}
              </fieldset>
              <fieldset>
                <legend>الألوان المعروضة على الموقع</legend>
                {[...new Set(product.variants.map((variant) => variant.colorId))].map((colorId) => {
                  const inColor = product.variants.filter((variant) => variant.colorId === colorId);
                  return <label key={colorId}>
                    <input
                      type="checkbox"
                      checked={inColor.every((variant) => variant.onlineVisible)}
                      onChange={(event) => setProduct((current) => ({ ...current, variants: current.variants.map((variant) => variant.colorId === colorId ? { ...variant, onlineVisible: event.target.checked } : variant) }))}
                    /> {colors.find((item) => item.id === colorId)?.nameAr ?? ""} ({inColor.filter((variant) => variant.onlineVisible).length}/{inColor.length})
                  </label>;
                })}
              </fieldset>
            </div>
            </details>
            <p className="catalog-pairs-title">التركيبات المحددة للعرض</p>
            <div className="catalog-pair-list">
            {product.variants.map((variant, index) => (
              <div className="variant-row" key={variant.key}>
                <label>
                  <input
                    type="checkbox"
                    checked={variant.onlineVisible}
                    onChange={(event) => updateVariant(index, { ...variant, onlineVisible: event.target.checked })}
                  /> عرض هذه التركيبة
                </label>
                <div className="field">
                  <label htmlFor={`variant-size-${index}`}>المقاس</label>
                  <select id={`variant-size-${index}`} value={variant.sizeId} onChange={(event) => updateVariant(index, { ...variant, sizeId: event.target.value })}>
                    <option value="">اختر مقاساً</option>
                    {sizes.filter((item) => item.id !== OPERATIONAL_SIZE_ID).map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`variant-color-${index}`}>اللون</label>
                  <select id={`variant-color-${index}`} value={variant.colorId} onChange={(event) => updateVariant(index, { ...variant, colorId: event.target.value })}>
                    <option value="">اختر لوناً</option>
                    {colors.filter((item) => item.id !== OPERATIONAL_COLOR_ID).map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}
                  </select>
                </div>
                {!variant.savedId ? <button type="button" className="secondary catalog-remove-pair" disabled={Boolean(productPending)} onClick={() => setProduct((current) => ({ ...current, variants: current.variants.filter((item) => item.key !== variant.key) }))}>إزالة</button> : null}
              </div>
            ))}
            </div>
            <button type="button" className="secondary" disabled={Boolean(productPending)} onClick={() => setProduct((current) => ({ ...current, variants: [...current.variants, { key: crypto.randomUUID(), savedId: null, sizeId: "", colorId: "", onlineVisible: true }] }))}>إضافة خيار للموقع</button>
          </fieldset>
          </div>
          <div className="form-actions catalog-save-actions">
            {editingId ? (
              <button
                type="button"
                className="secondary"
                disabled={Boolean(productPending)}
                onClick={() => {
                  if (JSON.stringify(product) !== savedDraft.current && !window.confirm("لديك تغييرات غير محفوظة. هل تريد إلغاء التعديل؟")) return;
                  setEditingId(null);
                  replaceProductDraft(emptyProduct());
                  productFeedback.clearHighlight();
                }}
              >
                إلغاء التعديل
              </button>
            ) : null}
            <button type="submit" disabled={Boolean(productPending)}>
              {productPending === "product" ? "جارٍ الحفظ…" : "حفظ التعديل"}
            </button>
          </div>
        </form> : <section className="card"><p className="muted">اختر منتجاً من القائمة لتعديل بياناته.</p></section>}
      </div>
      </div>
      <Modal open={taxonomyOpen} title="التصنيفات والمقاسات والألوان" onClose={() => setTaxonomyOpen(false)} wide>
        <div className="catalog-taxonomy">
          <form aria-label="إضافة تصنيف" onSubmit={(event) => void onCreateCategory(event)}>
            <div className="field">
              <label htmlFor="categoryName">اسم التصنيف</label>
              <input id="categoryName" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="categoryParent">التصنيف الرئيسي (اختياري)</label>
              <select id="categoryParent" value={parentId} onChange={(event) => setParentId(event.target.value)}>
                <option value="">تصنيف رئيسي</option>
                {roots.map((item) => (
                  <option key={item.id} value={item.id}>{item.nameAr}</option>
                ))}
              </select>
            </div>
            <div className="form-actions">
              <button type="submit" disabled={pending === "category"}>
                {pending === "category" ? "جارٍ الحفظ…" : "حفظ التصنيف"}
              </button>
            </div>
          </form>
          {categories.length > 0 ? (
            <div className="staff-list stacked-form">
              {categories.map((item) => (
                <article className="staff-item" key={item.id}>
                  <p className="muted">
                    {item.parentId
                      ? `${categories.find((parent) => parent.id === item.parentId)?.nameAr ?? ""} / ${item.nameAr}`
                      : item.nameAr}
                  </p>
                  <RenameForm
                    ariaLabel={`تعديل التصنيف ${item.nameAr}`}
                    inputId={`rename-category-${item.id}`}
                    label="اسم التصنيف"
                    nameAr={item.nameAr}
                    pending={pending === `category-${item.id}`}
                    onSave={(nameAr) => onRenameCategory(item.id, nameAr)}
                  />
                </article>
              ))}
            </div>
          ) : null}
          <form className="stacked-form" aria-label="إضافة مقاس" onSubmit={(event) => void onCreateSize(event)}>
            <div className="field">
              <label htmlFor="sizeName">اسم المقاس</label>
              <input id="sizeName" value={sizeName} onChange={(event) => setSizeName(event.target.value)} required />
            </div>
            <button type="submit" disabled={pending === "size"}>
              {pending === "size" ? "جارٍ الحفظ…" : "حفظ المقاس"}
            </button>
          </form>
          {sizes.length > 0 ? (
            <div className="staff-list stacked-form">
              {sizes.map((item) => (
                <article className="staff-item" key={item.id}>
                  <RenameForm
                    ariaLabel={`تعديل المقاس ${item.nameAr}`}
                    inputId={`rename-size-${item.id}`}
                    label="اسم المقاس"
                    nameAr={item.nameAr}
                    pending={pending === `size-${item.id}`}
                    onSave={(nameAr) => onRenameSize(item.id, nameAr)}
                  />
                </article>
              ))}
            </div>
          ) : null}
          <form className="stacked-form" aria-label="إضافة لون" onSubmit={(event) => void onCreateColor(event)}>
            <div className="field">
              <label htmlFor="colorName">اسم اللون</label>
              <input id="colorName" value={colorName} onChange={(event) => setColorName(event.target.value)} required />
            </div>
            <button type="submit" disabled={pending === "color"}>
              {pending === "color" ? "جارٍ الحفظ…" : "حفظ اللون"}
            </button>
          </form>
          {colors.length > 0 ? (
            <div className="staff-list stacked-form">
              {colors.map((item) => (
                <article className="staff-item" key={item.id}>
                  <RenameForm
                    ariaLabel={`تعديل اللون ${item.nameAr}`}
                    inputId={`rename-color-${item.id}`}
                    label="اسم اللون"
                    nameAr={item.nameAr}
                    pending={pending === `color-${item.id}`}
                    onSave={(nameAr) => onRenameColor(item.id, nameAr)}
                  />
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </Modal>
    </main>
  );

  function updateVariant(index: number, next: VariantDraft) {
    setProduct({
      ...product,
      variants: product.variants.map((item, itemIndex) => (itemIndex === index ? next : item)),
    });
  }
}

function publicationLabel(publication: PublicationStatus): string {
  if (publication === "available") return "متاح";
  if (publication === "coming_soon") return "قريباً";
  return "مخفي";
}

function RenameForm({
  ariaLabel,
  inputId,
  label,
  nameAr,
  pending,
  onSave,
}: {
  ariaLabel: string;
  inputId: string;
  label: string;
  nameAr: string;
  pending: boolean;
  onSave: (nameAr: string) => Promise<void>;
}) {
  const [value, setValue] = useState(nameAr);
  useEffect(() => {
    setValue(nameAr);
  }, [nameAr]);
  return (
    <form
      className="taxonomy-rename"
      aria-label={ariaLabel}
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(value);
      }}
    >
      <div className="field">
        <label htmlFor={inputId}>{label}</label>
        <input id={inputId} value={value} onChange={(event) => setValue(event.target.value)} required />
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "جارٍ الحفظ…" : "حفظ الاسم"}
      </button>
    </form>
  );
}
