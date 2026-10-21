import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";

import type {
  CategoryDto,
  ColorDto,
  ManagerProductDto,
  PublicationStatus,
  SizeDto,
  WorkspaceDto,
} from "@bravos/contracts";
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
import { EmptyState } from "../ui/EmptyState.tsx";
import { useRevealFeedback } from "../ui/useRevealFeedback.ts";


type VariantDraft = {
  key: string;
  sizeId: string;
  colorId: string;
  onlineVisible: boolean;
  overrideEgp: string;
};

type ProductDraft = {
  editRevision: number | null;
  code: string;
  nameAr: string;
  descriptionAr: string;
  categoryId: string;
  defaultEgp: string;
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

function useDesktopMerchandise(): boolean {
  const query = "(min-width: 1024px)";
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return desktop;
}

export default function CatalogPage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
  const [error, setError] = useState("");
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
  const desktop = useDesktopMerchandise();
  const [skuQuery, setSkuQuery] = useState("");
  const [product, setProduct] = useState<ProductDraft>(emptyProduct);
  const [pending, setPending] = useState("");
  const [productPending, setProductPending] = useState<"" | "media" | "product">("");
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
    });
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
    if (product.variants.length === 0) {
      setError("يجب تحديد متغير واحد على الأقل.");
      return;
    }
    const variants = [];
    for (const draft of product.variants) {
      if (!draft.sizeId || !draft.colorId) {
        setError("يجب تحديد المقاس واللون لكل متغير.");
        return;
      }
      let override: number | null = null;
      if (draft.overrideEgp.trim()) {
        override = egpInputToPiasters(draft.overrideEgp);
        if (override === null) {
          setError("سعر المتغير غير صالح.");
          return;
        }
      }
      variants.push({
        sizeId: draft.sizeId,
        colorId: draft.colorId,
        onlineVisible: draft.onlineVisible,
        sellingPricePiastersOverride: override,
      });
    }
    setProductPending("product");
    try {
      const payload = {
        expectedRevision,
        expectedVariantIds: product.variants.map((variant) => variant.key),
        code: product.code,
        nameAr: product.nameAr,
        descriptionAr: product.descriptionAr,
        categoryId: product.categoryId,
        defaultSellingPricePiasters,
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
    setError("");
    setNotice("");
    setEditingId(item.id);
    setSkuQuery(item.code);
    replaceProductDraft({
      editRevision: item.editRevision,
      code: item.code,
      nameAr: item.nameAr,
      descriptionAr: item.descriptionAr,
      categoryId: item.category.id,
      defaultEgp: piastersToEgpInput(item.defaultSellingPricePiasters),
      publication: item.publication,
      imageRefs: item.imageRefs,
      sizeGuideAr: item.sizeGuideAr ?? "",
      variants: item.variants.map((variant) => ({
        key: variant.id,
        sizeId: variant.size.id,
        colorId: variant.color.id,
        onlineVisible: variant.onlineVisible,
        overrideEgp:
          variant.sellingPricePiastersOverride === null
            ? ""
            : piastersToEgpInput(variant.sellingPricePiastersOverride),
      })),
    });
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
  const listedProducts = desktop ? matchedProducts : products;
  const browseActive = browseCategoryId !== "" || browseQuery.trim() !== "";
  const categoryOptions = categories
    .map((item) => ({ id: item.id, label: categoryPath(categories, item.id) || item.nameAr }))
    .sort((left, right) => left.label.localeCompare(right.label, "ar"));

  return (
    <main className="shell catalog-page">
      <header className="page-hero">
        <h1>إدارة المنتجات</h1>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}
      <div className="catalog-workspace">
      <div className="grid two catalog-top">
        <section className="card catalog-taxonomy">
          <h2>التصنيفات والمقاسات والألوان</h2>
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
        </section>
        <div className="stacked-form catalog-editor">
          <section className="card" aria-label="اختيار منتج من المخزون">
            <h2>اختيار منتج من المخزون</h2>
            <p className="muted">ابدأ بتسجيل المنتج ومقاساته وألوانه وكمياته من صفحة استلام المخزون، ثم اختر رمزه هنا لإعداد عرضه.</p>
            <div className="field">
              <label htmlFor="inventoryProductCode">رمز المنتج</label>
              <input
                id="inventoryProductCode"
                list="inventoryProductCodes"
                autoComplete="off"
                value={skuQuery}
                onChange={(event) => setSkuQuery(event.target.value)}
                placeholder="BRV-TSH-001"
              />
              <datalist id="inventoryProductCodes">
                {products
                  .filter((item) => item.code.toLocaleLowerCase().includes(skuQuery.trim().toLocaleLowerCase()))
                  .slice(0, 20)
                  .map((item) => <option key={item.id} value={item.code}>{item.nameAr}</option>)}
              </datalist>
            </div>
            <button
              type="button"
              disabled={Boolean(productPending) || !skuQuery.trim()}
              onClick={() => {
                const match = products.find((item) => item.code.toLocaleLowerCase() === skuQuery.trim().toLocaleLowerCase());
                if (!match) {
                  setError("رمز المنتج غير موجود في المخزون.");
                  return;
                }
                startEdit(match);
              }}
            >
              عرض المنتج
            </button>
          </section>
          {editingId ? <form
          ref={productFeedback.regionRef}
          className={`card reveal-feedback${productFeedback.highlighted ? " is-highlighted" : ""}`}
          aria-busy={Boolean(productPending)}
          aria-label="تعديل منتج"
          onSubmit={(event) => void onSaveProduct(event)}
        >
          <h2 ref={productFeedback.headingRef} tabIndex={-1}>تعديل منتج</h2>
          <div className="field">
            <label htmlFor="productCode">رمز المنتج</label>
            <input id="productCode" value={product.code} readOnly />
          </div>
          <div className="field">
            <label htmlFor="productName">اسم المنتج</label>
            <input id="productName" value={product.nameAr} onChange={(event) => setProduct({ ...product, nameAr: event.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="productDescription">الوصف</label>
            <textarea id="productDescription" value={product.descriptionAr} onChange={(event) => setProduct({ ...product, descriptionAr: event.target.value })} rows={3} />
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
            <label htmlFor="productPrice">سعر البيع الافتراضي بالجنيه</label>
            <input id="productPrice" inputMode="decimal" value={product.defaultEgp} onChange={(event) => setProduct({ ...product, defaultEgp: event.target.value })} required />
          </div>
          <div className="field">
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
          <div className="field">
            <label htmlFor="productSizeGuide">دليل المقاسات (اختياري)</label>
            <textarea
              id="productSizeGuide"
              value={product.sizeGuideAr}
              onChange={(event) => setProduct({ ...product, sizeGuideAr: event.target.value })}
              rows={5}
              maxLength={4000}
              placeholder="مثال: المقاس L — عرض الصدر 52 سم"
            />
          </div>
          <fieldset className="grant-editor">
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
                    <button
                      type="button"
                      className="secondary"
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
          <fieldset className="grant-editor">
            <legend>المقاسات والألوان المسجلة في المخزون</legend>
            <p className="muted">حدّد المقاس واللون اللذين يظهران في المتجر. نفاد الكمية يوقف الطلب تلقائياً.</p>
            <details className="business-disclosure">
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
            <p>التركيبات المحددة للعرض</p>
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
                  <input id={`variant-size-${index}`} value={sizes.find((item) => item.id === variant.sizeId)?.nameAr ?? ""} readOnly />
                </div>
                <div className="field">
                  <label htmlFor={`variant-color-${index}`}>اللون</label>
                  <input id={`variant-color-${index}`} value={colors.find((item) => item.id === variant.colorId)?.nameAr ?? ""} readOnly />
                </div>
                <div className="field">
                  <label htmlFor={`variant-price-${index}`}>سعر مختلف للمتغير (اختياري)</label>
                  <input
                    id={`variant-price-${index}`}
                    inputMode="decimal"
                    value={variant.overrideEgp}
                    onChange={(event) => updateVariant(index, { ...variant, overrideEgp: event.target.value })}
                  />
                </div>
              </div>
            ))}
          </fieldset>
          <div className="form-actions">
            {editingId ? (
              <button
                type="button"
                className="secondary"
                disabled={Boolean(productPending)}
                onClick={() => {
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
        </form> : <section className="card"><p className="muted">اختر رمز منتج لعرض تفاصيله وتعديل بياناته.</p></section>}
        </div>
      </div>
      <section className="card catalog-browse">
        <h2>المنتجات</h2>
        {desktop ? <p id="catalog-browse-count" data-testid="catalog-browse-count">المطابق: {matchedProducts.length} من {products.length}</p> : null}
        {desktop ? (
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
        ) : null}
        {products.length === 0 ? (
          <EmptyState title="لسه مفيش منتجات" message="ابدأ بإضافة أول صنف من صفحة استلام المخزون." />
        ) : listedProducts.length === 0 ? (
          <p data-testid="catalog-browse-empty">لا توجد منتجات مطابقة.</p>
        ) : (
          <div className="staff-list">
            {listedProducts.map((item) => (
              <article className="staff-item" key={item.id}>
                <strong>{item.nameAr}</strong>
                <p className="muted">رمز المنتج: {item.code} — {item.category.nameAr}</p>
                <p className="category-path">المسار: {categoryPath(categories, item.category.id) || item.category.nameAr}</p>
                <p>حالة الموقع: {publicationLabel(item.publication)}</p>
                <p>السعر الافتراضي: {formatEgpFromPiasters(item.defaultSellingPricePiasters)}</p>
                <p>
                  المتغيرات: {item.variants.map((variant) => `${variant.size.nameAr} / ${variant.color.nameAr} (${formatEgpFromPiasters(variant.sellingPricePiasters)})`).join("، ")}
                </p>
                <div className="form-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={Boolean(productPending)}
                    onClick={() => startEdit(item)}
                  >
                    تعديل
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      </div>
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
