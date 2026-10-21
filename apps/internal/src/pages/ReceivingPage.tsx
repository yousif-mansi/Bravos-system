import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type {
  CategoryDto,
  ColorDto,
  InventoryBatchDto,
  InventorySettingsDto,
  LowStockVariantDto,
  ManagerProductDto,
  ReceiptDto,
  SizeDto,
  WorkspaceDto,
} from "@bravos/contracts";
import {
  ApiError,
  correctReceipt,
  createCategory,
  createColor,
  createProduct,
  createSize,
  finalizeReceipt,
  getReceipt,
  getInventorySettings,
  listBatches,
  listCategories,
  listColors,
  listLowStock,
  listProducts,
  listReceipts,
  listSizes,
  lookupReceivingOperation,
  setVariantLowStockThreshold,
  updateInventorySettings,
  updateProduct,
} from "../api.ts";
import { egpInputToPiasters, formatEgpFromPiasters, piastersToEgpInput } from "../money.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { useRevealFeedback } from "../ui/useRevealFeedback.ts";

import {
  assignPendingReceive,
  clearPendingReceive,
  digestReceivePayload,
  loadPendingReceive,
  pendingStorageKey,
  savePendingReceive,
  withPendingMarkerLock,
  type PendingReceive,
  type ReceivePayloadLines,
} from "../receiving-pending.ts";

type DraftLine = {
  key: string;
  productId: string;
  variantId: string;
  quantity: string;
  costEgp: string;
};

type NewInventoryVariant = {
  key: string;
  sizeId: string;
  colorId: string;
  quantity: string;
  costEgp: string;
};

type NewInventoryProduct = {
  code: string;
  nameAr: string;
  categoryId: string;
  defaultEgp: string;
  variants: NewInventoryVariant[];
};

function emptyNewInventoryVariant(): NewInventoryVariant {
  return { key: crypto.randomUUID(), sizeId: "", colorId: "", quantity: "", costEgp: "" };
}

function emptyNewInventoryProduct(): NewInventoryProduct {
  return { code: "", nameAr: "", categoryId: "", defaultEgp: "", variants: [emptyNewInventoryVariant()] };
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

function matchedProducts(products: ManagerProductDto[], categories: CategoryDto[], categoryId: string, query: string): ManagerProductDto[] {
  return products.filter((item) => categoryInBranch(categories, item.category.id, categoryId) && matchesNameOrSku(item, query));
}

function ProductChoiceOptions({
  products,
  categories,
  desktop,
  categoryId,
  query,
  selectedId,
}: {
  products: ManagerProductDto[];
  categories: CategoryDto[];
  desktop: boolean;
  categoryId: string;
  query: string;
  selectedId: string;
}) {
  if (!desktop) {
    return products.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.nameAr}</option>);
  }
  const matched = matchedProducts(products, categories, categoryId, query);
  // A desktop filter only hides other choices. The selected id stays selectable so the draft,
  // variant, quantity, and any frozen receipt identity do not change with the filter.
  const pinned = selectedId && !matched.some((item) => item.id === selectedId)
    ? products.find((item) => item.id === selectedId)
    : undefined;
  const groups = new Map<string, { id: string; label: string; items: ManagerProductDto[] }>();
  for (const item of matched) {
    const id = item.category.id;
    const group = groups.get(id);
    if (group) group.items.push(item);
    else groups.set(id, { id, label: categoryPath(categories, id) || item.category.nameAr, items: [item] });
  }
  const ordered = [...groups.values()].sort((left, right) => left.label.localeCompare(right.label, "ar"));
  return (
    <>
      {pinned ? (
        <optgroup label="الاختيار الحالي">
          <option value={pinned.id}>{pinned.code} — {pinned.nameAr}</option>
        </optgroup>
      ) : null}
      {ordered.map((group) => (
        <optgroup key={group.id} label={group.label}>
          {group.items.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.nameAr}</option>)}
        </optgroup>
      ))}
    </>
  );
}

function MerchandiseFilters({
  idPrefix,
  categories,
  categoryId,
  query,
  matched,
  total,
  onCategoryId,
  onQuery,
  onClear,
}: {
  idPrefix: string;
  categories: CategoryDto[];
  categoryId: string;
  query: string;
  matched: number;
  total: number;
  onCategoryId: (value: string) => void;
  onQuery: (value: string) => void;
  onClear: () => void;
}) {
  const options = categories
    .map((item) => ({ id: item.id, label: categoryPath(categories, item.id) || item.nameAr }))
    .sort((left, right) => left.label.localeCompare(right.label, "ar"));
  const active = categoryId !== "" || query.trim() !== "";
  return (
    <div className="merchandise-filters" role="group" aria-label="تنظيم المنتجات" data-testid={`${idPrefix}-filters`}>
      <div className="field">
        <label htmlFor={`${idPrefix}-category`}>الفئة</label>
        <select id={`${idPrefix}-category`} value={categoryId} aria-describedby={`${idPrefix}-count`} onChange={(event) => onCategoryId(event.target.value)}>
          <option value="">كل الفئات</option>
          {options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-query`}>الاسم أو رمز SKU</label>
        <input
          id={`${idPrefix}-query`}
          value={query}
          autoComplete="off"
          placeholder="اسم أو رمز"
          aria-describedby={`${idPrefix}-count`}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        />
      </div>
      <div className="merchandise-filter-meta">
        <p id={`${idPrefix}-count`} data-testid={`${idPrefix}-count`}>المطابق: {matched} من {total}</p>
        {active ? <button type="button" onClick={onClear}>مسح التصفية</button> : null}
      </div>
    </div>
  );
}

type CorrectionDraftLine = {
  lineId: string;
  label: string;
  quantity: string;
  costEgp: string;
};

type CorrectionPayload = {
  receiptId: string;
  expectedRevision: number;
  reason: string;
  lines: Array<{ lineId: string; quantity: number; unitCostPiasters: number }>;
};

async function digestCorrectionPayload(input: CorrectionPayload): Promise<string> {
  const canonical = JSON.stringify({
    receiptId: input.receiptId,
    expectedRevision: input.expectedRevision,
    reason: input.reason.trim(),
    lines: [...input.lines].sort((left, right) => left.lineId.localeCompare(right.lineId)),
  });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function emptyLine(): DraftLine {
  return { key: crypto.randomUUID(), productId: "", variantId: "", quantity: "", costEgp: "" };
}

function todayCairoDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function ReceivingPage({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceDto;
  onChanged: (workspace: WorkspaceDto | null) => void;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");
  const [products, setProducts] = useState<ManagerProductDto[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [sizes, setSizes] = useState<SizeDto[]>([]);
  const [colors, setColors] = useState<ColorDto[]>([]);
  const [newInventoryProduct, setNewInventoryProduct] = useState<NewInventoryProduct>(emptyNewInventoryProduct);
  const [intakeMode, setIntakeMode] = useState<"new" | "existing">("new");
  const [intakeBrowseCategoryId, setIntakeBrowseCategoryId] = useState("");
  const [intakeBrowseQuery, setIntakeBrowseQuery] = useState("");
  const [receiptBrowseCategoryId, setReceiptBrowseCategoryId] = useState("");
  const [receiptBrowseQuery, setReceiptBrowseQuery] = useState("");
  const desktop = useDesktopMerchandise();
  const [categoryName, setCategoryName] = useState("");
  const [categoryParentId, setCategoryParentId] = useState("");
  const [sizeName, setSizeName] = useState("");
  const [colorName, setColorName] = useState("");
  const [savedNewProduct, setSavedNewProduct] = useState<ManagerProductDto | null>(null);
  const [savedNewReceipt, setSavedNewReceipt] = useState<{ branchId: string; receiptDate: string; lines: ReceivePayloadLines } | null>(null);
  const [branchId, setBranchId] = useState(workspace.activeBranch?.id ?? workspace.authorizedBranches[0]?.id ?? "");
  const receiptFeedback = useRevealFeedback<HTMLElement>();
  const correctionFeedback = useRevealFeedback<HTMLFormElement>();
  const intakeFeedback = useRevealFeedback<HTMLFormElement>();
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ReceiptDto[]>([]);
  const [batches, setBatches] = useState<InventoryBatchDto[]>([]);
  const [lowStock, setLowStock] = useState<LowStockVariantDto[]>([]);
  const [settings, setSettings] = useState<InventorySettingsDto | null>(null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [receiptDate, setReceiptDate] = useState(todayCairoDate);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [thresholdInput, setThresholdInput] = useState("3");
  const [overrideVariantId, setOverrideVariantId] = useState("");
  const [overrideThreshold, setOverrideThreshold] = useState("");
  const [editingCorrection, setEditingCorrection] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionLines, setCorrectionLines] = useState<CorrectionDraftLine[]>([]);
  const [correctionRetryReady, setCorrectionRetryReady] = useState(false);
  const [pendingReceive, setPendingReceive] = useState<PendingReceive | null>(null);
  const [frozenPayload, setFrozenPayload] = useState<{
    branchId: string;
    receiptDate: string;
    lines: ReceivePayloadLines;
  } | null>(null);
  const inFlightRef = useRef(false);
  const pendingReceiveRef = useRef<PendingReceive | null>(null);
  const frozenPayloadRef = useRef<{
    branchId: string;
    receiptDate: string;
    lines: ReceivePayloadLines;
  } | null>(null);
  const correctionAttemptRef = useRef<{ digest: string; operationId: string } | null>(null);
  const correctionInFlightRef = useRef(false);
  // A page-load read can resolve after the cashier has already saved a category, size, or color.
  // That older payload must not replace the lists the form is using.
  const taxonomyRevisionRef = useRef(0);

  async function refresh() {
    const taxonomyRevision = taxonomyRevisionRef.current;
    const [nextProducts, nextReceipts, nextBatches, nextLowStock, nextSettings, nextCategories, nextSizes, nextColors] = await Promise.all([
      listProducts(),
      listReceipts(),
      listBatches(),
      listLowStock(),
      getInventorySettings(),
      listCategories(),
      listSizes(),
      listColors(),
    ]);
    setProducts(nextProducts);
    setReceipts(nextReceipts);
    setBatches(nextBatches);
    setLowStock(nextLowStock);
    setSettings(nextSettings);
    setThresholdInput(String(nextSettings.lowStockThreshold));
    if (taxonomyRevision !== taxonomyRevisionRef.current) return;
    setCategories(nextCategories);
    setSizes(nextSizes);
    setColors(nextColors);
  }

  useEffect(() => {
    void refresh().catch((caught: unknown) => {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل الاستلام.");
    });
  }, []);

  useEffect(() => {
    const stored = loadPendingReceive(workspace.staff.id);
    if (!stored) {
      return;
    }
    pendingReceiveRef.current = stored;
    setPendingReceive(stored);
    let cancelled = false;
    inFlightRef.current = true;
    setPending("check");
    lookupReceivingOperation(stored.operationId)
      .then((found) => {
        if (cancelled) {
          return;
        }
        if (found) {
          return acceptReceipt(found, "تم العثور على إذن الاستلام المحفوظ.");
        }
        if (stored.phase === "uncertain") {
          setError("لم يُؤكد الحفظ بعد. أدخل البيانات نفسها ثم أعد المحاولة أو تحقق لاحقاً. لا تبدأ إذناً جديداً.");
        } else {
          setError("لم تُقبل العملية. صحّح البيانات وأعد المحاولة دون بدء إذن جديد.");
        }
        return undefined;
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.messageAr : "تعذر التحقق من عملية الاستلام.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          inFlightRef.current = false;
          setPending("");
        }
      });
    return () => {
      cancelled = true;
      inFlightRef.current = false;
    };
  }, [workspace.staff.id]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== pendingStorageKey(workspace.staff.id)) {
        return;
      }
      if (pendingReceiveRef.current) {
        return;
      }
      const stored = loadPendingReceive(workspace.staff.id);
      pendingReceiveRef.current = stored;
      setPendingReceive(stored);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [workspace.staff.id]);

  const selectedReceipt = receipts.find((item) => item.id === selectedReceiptId) ?? receipts[0] ?? null;
  const formLocked = pendingReceive?.phase === "uncertain" && frozenPayload !== null;
  const selectedExistingProduct = products.find((item) => item.code === newInventoryProduct.code) ?? null;

  const variantOptions = useMemo(() => {
    return products.flatMap((product) =>
      product.variants.map((variant) => ({
        product,
        variant,
        label: `${product.code} — ${product.nameAr} / ${variant.size.nameAr} / ${variant.color.nameAr}`,
      })),
    );
  }, [products]);

  function parseDraftLines(): ReceivePayloadLines | null {
    const parsed: ReceivePayloadLines = [];
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const unitCostPiasters = egpInputToPiasters(line.costEgp);
      if (!line.variantId) {
        setError("يجب تحديد المقاس واللون لكل صنف.");
        return null;
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        setError("الكمية غير صالحة.");
        return null;
      }
      if (unitCostPiasters === null) {
        setError("تكلفة الشراء غير صالحة.");
        return null;
      }
      parsed.push({ variantId: line.variantId, quantity, unitCostPiasters });
    }
    return parsed;
  }

  async function acceptReceipt(receipt: ReceiptDto, messageAr: string) {
    await withPendingMarkerLock(workspace.staff.id, () => {
      clearPendingReceive(workspace.staff.id, receipt.operationId);
    });
    pendingReceiveRef.current = null;
    frozenPayloadRef.current = null;
    setPendingReceive(null);
    setFrozenPayload(null);
    setNotice(messageAr);
    setError("");
    setLines([emptyLine()]);
    setSelectedReceiptId(receipt.id);
    setSavedNewProduct(null);
    setSavedNewReceipt(null);
    setNewInventoryProduct(emptyNewInventoryProduct());
    setIntakeMode("new");
    await refresh();
  }

  async function submitPayload(payload: { branchId: string; receiptDate: string; lines: ReceivePayloadLines }) {
    let digest: string;
    try {
      digest = await digestReceivePayload(payload);
    } catch {
      setError("تعذر تجهيز عملية الاستلام.");
      return;
    }
    let assignment: Awaited<ReturnType<typeof assignPendingReceive>>;
    try {
      assignment = await withPendingMarkerLock(workspace.staff.id, () =>
        assignPendingReceive({
          staffId: workspace.staff.id,
          digest,
          localOperationId: pendingReceiveRef.current?.operationId ?? null,
        }),
      );
    } catch {
      setError("تعذر حفظ معرّف العملية.");
      return;
    }
    if (assignment.kind === "blocked") {
      if (pendingReceiveRef.current && frozenPayloadRef.current) {
        setError("يجب إدخال نفس بيانات العملية غير المؤكدة.");
        return;
      }
      pendingReceiveRef.current = assignment.pending;
      setPendingReceive(assignment.pending);
      frozenPayloadRef.current = null;
      setFrozenPayload(null);
      setError("توجد عملية استلام غير مؤكدة. تحقق من نتيجتها قبل بدء إذن جديد.");
      return;
    }
    const nextPending = assignment.pending;
    pendingReceiveRef.current = nextPending;
    setPendingReceive(nextPending);
    frozenPayloadRef.current = payload;
    setFrozenPayload(payload);
    try {
      const created = await finalizeReceipt({
        operationId: nextPending.operationId,
        branchId: payload.branchId,
        receiptDate: payload.receiptDate,
        lines: payload.lines,
      });
      await acceptReceipt(created, "تم حفظ إذن الاستلام.");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        const found = await lookupReceivingOperation(nextPending.operationId);
        if (found) {
          await acceptReceipt(found, "تم العثور على إذن الاستلام المحفوظ.");
          return;
        }
      }
      if (caught instanceof ApiError && (caught.status === 400 || caught.status === 404)) {
        const rejected: PendingReceive = {
          ...nextPending,
          phase: "rejected",
          digest: null,
        };
        await withPendingMarkerLock(workspace.staff.id, () => {
          const stored = loadPendingReceive(workspace.staff.id);
          if (stored && stored.operationId !== rejected.operationId) {
            return;
          }
          savePendingReceive(rejected);
        });
        pendingReceiveRef.current = rejected;
        frozenPayloadRef.current = null;
        setPendingReceive(rejected);
        setFrozenPayload(null);
        setError(caught.messageAr);
        return;
      }
      const uncertain: PendingReceive = { ...nextPending, phase: "uncertain", digest };
      await withPendingMarkerLock(workspace.staff.id, () => {
        const stored = loadPendingReceive(workspace.staff.id);
        if (stored && stored.operationId !== uncertain.operationId) {
          return;
        }
        savePendingReceive(uncertain);
      });
      pendingReceiveRef.current = uncertain;
      setPendingReceive(uncertain);
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ الاستلام.");
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setPending("receive");
    setError("");
    setNotice("");
    try {
      if (!branchId || !workspace.authorizedBranches.some((branch) => branch.id === branchId)) {
        setError("اختر فرع الاستلام قبل الحفظ.");
        return;
      }
      const payload =
        frozenPayloadRef.current ??
        (pendingReceiveRef.current?.phase === "uncertain" && frozenPayload
          ? frozenPayload
          : (() => {
              const parsed = parseDraftLines();
              return parsed ? { branchId, receiptDate, lines: parsed } : null;
            })());
      if (!payload) {
        return;
      }
      await submitPayload(payload);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ الاستلام.");
    } finally {
      inFlightRef.current = false;
      setPending("");
    }
  }

  async function addTaxonomy(event: FormEvent, kind: "category" | "size" | "color") {
    event.preventDefault();
    setError("");
    setNotice("");
    setPending(`taxonomy-${kind}`);
    try {
      if (kind === "category") {
        const created = await createCategory({ nameAr: categoryName, ...(categoryParentId ? { parentId: categoryParentId } : {}) });
        taxonomyRevisionRef.current += 1;
        setCategories(await listCategories());
        setCategoryName("");
        setCategoryParentId("");
        setNewInventoryProduct((current) => ({ ...current, categoryId: created.id }));
      } else if (kind === "size") {
        const created = await createSize(sizeName);
        taxonomyRevisionRef.current += 1;
        setSizes(await listSizes());
        setSizeName("");
        setNewInventoryProduct((current) => ({ ...current, variants: current.variants.map((row, index) => index === 0 && !row.sizeId ? { ...row, sizeId: created.id } : row) }));
      } else {
        const created = await createColor(colorName);
        taxonomyRevisionRef.current += 1;
        setColors(await listColors());
        setColorName("");
        setNewInventoryProduct((current) => ({ ...current, variants: current.variants.map((row, index) => index === 0 && !row.colorId ? { ...row, colorId: created.id } : row) }));
      }
      setNotice("تم حفظ الاختيار وإتاحته لنموذج المخزون.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ الاختيار.");
    } finally {
      setPending("");
    }
  }

  function parseNewInventoryProduct() {
    const price = egpInputToPiasters(newInventoryProduct.defaultEgp);
    if (!branchId || !workspace.authorizedBranches.some((branch) => branch.id === branchId)) {
      setError("اختر الفرع الذي ستدخل إليه الكمية.");
      return null;
    }
    if (!newInventoryProduct.code.trim() || !newInventoryProduct.nameAr.trim() || !newInventoryProduct.categoryId || price === null) {
      setError("أدخل رمز المنتج واسمه وتصنيفه وسعر بيعه.");
      return null;
    }
    const seen = new Set<string>();
    const variants: Array<{ sizeId: string; colorId: string; quantity: number; unitCostPiasters: number }> = [];
    for (const row of newInventoryProduct.variants) {
      const quantity = Number(row.quantity);
      const unitCostPiasters = egpInputToPiasters(row.costEgp);
      const pair = `${row.sizeId}:${row.colorId}`;
      if (!row.sizeId || !row.colorId || !Number.isInteger(quantity) || quantity < 1 || unitCostPiasters === null) {
        setError("أدخل المقاس واللون والكمية وتكلفة الشراء لكل تركيبة.");
        return null;
      }
      if (seen.has(pair)) {
        setError("لا يمكن تكرار نفس المقاس واللون للمنتج.");
        return null;
      }
      seen.add(pair);
      variants.push({ sizeId: row.sizeId, colorId: row.colorId, quantity, unitCostPiasters });
    }
    return { price, variants };
  }

  function receiptForNewProduct(product: ManagerProductDto, variants: NonNullable<ReturnType<typeof parseNewInventoryProduct>>["variants"]) {
    const receiptLines: ReceivePayloadLines = [];
    for (const row of variants) {
      const match = product.variants.find((variant) => variant.size.id === row.sizeId && variant.color.id === row.colorId);
      if (!match) return null;
      receiptLines.push({ variantId: match.id, quantity: row.quantity, unitCostPiasters: row.unitCostPiasters });
    }
    return { branchId, receiptDate, lines: receiptLines };
  }

  async function onCreateAndReceive(event: FormEvent) {
    event.preventDefault();
    if (inFlightRef.current) return;
    if (pendingReceiveRef.current && !savedNewReceipt && !(savedNewProduct && pendingReceiveRef.current.phase === "rejected")) {
      setError("تحقق من عملية الاستلام السابقة قبل إضافة منتج جديد.");
      return;
    }
    inFlightRef.current = true;
    setPending("new-product");
    setError("");
    setNotice("");
    try {
      if (savedNewReceipt) {
        await submitPayload(savedNewReceipt);
        return;
      }
      const parsed = parseNewInventoryProduct();
      if (!parsed) return;
      let created: ManagerProductDto;
      if (savedNewProduct) {
        created = savedNewProduct;
      } else if (intakeMode === "new") {
        if (products.some((item) => item.code.trim().toLocaleLowerCase() === newInventoryProduct.code.trim().toLocaleLowerCase())) {
          setError("رمز المنتج موجود بالفعل. اختره من إذن الاستلام أدناه أو استخدم استعادة المنتج المحفوظ.");
          return;
        }
        created = await createProduct({
          code: newInventoryProduct.code.trim(),
          nameAr: newInventoryProduct.nameAr.trim(),
          descriptionAr: "",
          categoryId: newInventoryProduct.categoryId,
          defaultSellingPricePiasters: parsed.price,
          publication: "hidden",
          imageRefs: [],
          sizeGuideAr: null,
          variants: parsed.variants.map((row) => ({ sizeId: row.sizeId, colorId: row.colorId, onlineVisible: false, sellingPricePiastersOverride: null })),
        });
      } else {
        const latest = await listProducts();
        const existing = latest.find((item) => item.code.trim().toLocaleLowerCase() === newInventoryProduct.code.trim().toLocaleLowerCase());
        if (!existing) {
          setError("اختر منتجاً موجوداً لإضافة تركيبة جديدة.");
          return;
        }
        if (parsed.variants.some((row) => existing.variants.some((variant) => variant.size.id === row.sizeId && variant.color.id === row.colorId))) {
          setError("هذه التركيبة موجودة بالفعل. استخدم إذن الاستلام المعتاد لإضافة كميتها.");
          return;
        }
        created = await updateProduct(existing.id, {
          expectedRevision: existing.editRevision,
          expectedVariantIds: existing.variants.map((variant) => variant.id),
          code: existing.code,
          nameAr: existing.nameAr,
          descriptionAr: existing.descriptionAr,
          categoryId: existing.category.id,
          defaultSellingPricePiasters: existing.defaultSellingPricePiasters,
          publication: existing.publication,
          imageRefs: existing.imageRefs,
          sizeGuideAr: existing.sizeGuideAr,
          variants: [
            ...existing.variants.map((variant) => ({ sizeId: variant.size.id, colorId: variant.color.id, sellingPricePiastersOverride: variant.sellingPricePiastersOverride, onlineVisible: variant.onlineVisible })),
            ...parsed.variants.map((row) => ({ sizeId: row.sizeId, colorId: row.colorId, sellingPricePiastersOverride: null, onlineVisible: false })),
          ],
        });
      }
      const payload = receiptForNewProduct(created, parsed.variants);
      if (!payload) throw new Error("Variant identity missing after product creation.");
      setSavedNewProduct(created);
      setSavedNewReceipt(payload);
      setProducts((current) => [...current.filter((item) => item.id !== created.id), created]);
      setLines(payload.lines.map((line) => ({
        key: crypto.randomUUID(),
        productId: created.id,
        variantId: line.variantId,
        quantity: String(line.quantity),
        costEgp: piastersToEgpInput(line.unitCostPiasters),
      })));
      setNotice(`حُفظ المنتج ${created.code}. يجري تسجيل الكمية في ${workspace.authorizedBranches.find((branch) => branch.id === branchId)?.nameAr ?? "الفرع"}.`);
      await submitPayload(payload);
    } catch (caught) {
      setError(caught instanceof ApiError ? `${caught.messageAr} تحقق من رمز المنتج قبل إعادة الإنشاء؛ قد يكون حُفظ بالفعل.` : "تعذر إكمال إنشاء المنتج. تحقق من رمزه في القائمة ثم أكمل الاستلام للمنتج المحفوظ.");
    } finally {
      inFlightRef.current = false;
      setPending("");
    }
  }

  async function recoverNewInventoryProduct() {
    if (inFlightRef.current) return;
    const parsed = parseNewInventoryProduct();
    if (!parsed) return;
    inFlightRef.current = true;
    setPending("recover-product");
    setError("");
    try {
      const current = await listProducts();
      setProducts(current);
      const found = current.find((item) => item.code.trim().toLocaleLowerCase() === newInventoryProduct.code.trim().toLocaleLowerCase());
      if (!found || found.nameAr !== newInventoryProduct.nameAr.trim() || (intakeMode === "new" && found.variants.length !== parsed.variants.length) || parsed.variants.some((row) => !found.variants.some((variant) => variant.size.id === row.sizeId && variant.color.id === row.colorId))) {
        setError("لم نجد منتجاً محفوظاً يطابق الرمز والاسم وتركيبات المقاس واللون. راجع البيانات قبل الاستلام.");
        return;
      }
      const payload = receiptForNewProduct(found, parsed.variants);
      if (!payload) return;
      setSavedNewProduct(found);
      setSavedNewReceipt(payload);
      setLines(payload.lines.map((line) => ({ key: crypto.randomUUID(), productId: found.id, variantId: line.variantId, quantity: String(line.quantity), costEgp: piastersToEgpInput(line.unitCostPiasters) })));
      setNotice(`وُجد المنتج ${found.code}. اضغط «حفظ كمية المنتج» لإكمال الاستلام دون إنشاء المنتج مرة أخرى.`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر البحث عن المنتج المحفوظ.");
    } finally {
      inFlightRef.current = false;
      setPending("");
    }
  }

  async function onCheckResult() {
    if (inFlightRef.current) {
      return;
    }
    const current = pendingReceiveRef.current;
    if (!current) {
      return;
    }
    inFlightRef.current = true;
    setPending("check");
    setError("");
    setNotice("");
    try {
      const found = await lookupReceivingOperation(current.operationId);
      if (found) {
        await acceptReceipt(found, "تم العثور على إذن الاستلام المحفوظ.");
        return;
      }
      setError("لم يُؤكد الحفظ بعد. أعد المحاولة أو تحقق لاحقاً. لا تبدأ إذناً جديداً.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر التحقق من عملية الاستلام.");
    } finally {
      inFlightRef.current = false;
      setPending("");
    }
  }

  async function onSaveThreshold(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const lowStockThreshold = Number(thresholdInput);
    if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
      setError("حد التنبيه غير صالح.");
      return;
    }
    setPending("settings");
    try {
      const updated = await updateInventorySettings(lowStockThreshold);
      setSettings(updated);
      setNotice("تم حفظ حد التنبيه.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ حد التنبيه.");
    } finally {
      setPending("");
    }
  }

  async function onSaveOverride(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!overrideVariantId) {
      setError("يجب تحديد المقاس واللون لحد التنبيه.");
      return;
    }
    const trimmed = overrideThreshold.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      setError("حد التنبيه غير صالح.");
      return;
    }
    setPending("override");
    try {
      await setVariantLowStockThreshold(overrideVariantId, value);
      setNotice(value === null ? "تم حذف حد المقاس واللون." : "تم حفظ حد المقاس واللون.");
      setOverrideThreshold("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ حد المقاس واللون.");
    } finally {
      setPending("");
    }
  }

  function beginCorrection() {
    if (!selectedReceipt) return;
    resetCorrectionAttempt();
    setCorrectionReason("");
    setCorrectionLines(selectedReceipt.lines.map((line) => ({
      lineId: line.id,
      label: `${line.variant.product.code} / ${line.variant.size.nameAr} / ${line.variant.color.nameAr}`,
      quantity: String(line.effectiveQuantity),
      costEgp: piastersToEgpInput(line.effectiveUnitCostPiasters),
    })));
    setEditingCorrection(true);
    correctionFeedback.reveal();
  }

  function resetCorrectionAttempt() {
    correctionAttemptRef.current = null;
    setCorrectionRetryReady(false);
  }

  async function onCorrectReceipt(event: FormEvent) {
    event.preventDefault();
    if (!selectedReceipt || correctionInFlightRef.current) return;
    const parsed = correctionLines.map((line) => ({
      lineId: line.lineId,
      quantity: Number(line.quantity),
      unitCostPiasters: egpInputToPiasters(line.costEgp),
    }));
    if (parsed.some((line) => !Number.isInteger(line.quantity) || line.quantity < 0)) {
      setError("الكمية غير صالحة.");
      return;
    }
    if (parsed.some((line) => line.unitCostPiasters === null)) {
      setError("تكلفة الشراء غير صالحة.");
      return;
    }
    correctionInFlightRef.current = true;
    try {
      const payload: CorrectionPayload = {
        receiptId: selectedReceipt.id,
        expectedRevision: selectedReceipt.correctionRevision,
        reason: correctionReason.trim(),
        lines: parsed.map((line) => ({
          lineId: line.lineId,
          quantity: line.quantity,
          unitCostPiasters: line.unitCostPiasters!,
        })),
      };
      const digest = await digestCorrectionPayload(payload);
      const attempt = correctionAttemptRef.current?.digest === digest
        ? correctionAttemptRef.current
        : { digest, operationId: crypto.randomUUID() };
      correctionAttemptRef.current = attempt;
      setPending("correction");
      setError("");
      setNotice("");
      await correctReceipt(selectedReceipt.id, {
        operationId: attempt.operationId,
        expectedRevision: payload.expectedRevision,
        reason: payload.reason,
        lines: payload.lines,
      });
      resetCorrectionAttempt();
      setEditingCorrection(false);
      setNotice("تم حفظ تصحيح إذن الاستلام.");
      await refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500) {
        resetCorrectionAttempt();
      } else {
        setCorrectionRetryReady(true);
      }
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر حفظ تصحيح إذن الاستلام.");
    } finally {
      correctionInFlightRef.current = false;
      setPending("");
    }
  }

  async function openReceiptDetails(receiptId: string) {
    if (detailLoadingId) return;
    setDetailLoadingId(receiptId);
    setError("");
    try {
      const detail = await getReceipt(receiptId);
      setReceipts((current) => current.map((item) => item.id === receiptId ? detail : item));
      setSelectedReceiptId(receiptId);
      setEditingCorrection(false);
      resetCorrectionAttempt();
      receiptFeedback.reveal();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر تحميل تفاصيل الاستلام.");
    } finally {
      setDetailLoadingId(null);
    }
  }

  return (
    <main className="shell receiving-page">
      <header className="page-hero">
        <h1>استلام المخزون</h1>
      </header>
      {typeof navigator !== "undefined" && !navigator.onLine ? (
        <div className="error" role="alert">استلام المخزون يتطلب اتصالاً.</div>
      ) : null}
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}

      <section className="card">
        <h2>فرع استلام المخزون</h2>
        <div className="field">
          <label htmlFor="receivingBranch">الفرع الذي ستدخل إليه الكمية</label>
          <select id="receivingBranch" value={branchId} onChange={(event) => setBranchId(event.target.value)} disabled={formLocked || Boolean(savedNewReceipt) || Boolean(pending)} required>
            <option value="">اختر الفرع</option>
            {workspace.authorizedBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.nameAr}</option>)}
          </select>
        </div>
      </section>

      <form className="card" aria-label="تسجيل إذن استلام" onSubmit={(event) => void onSubmit(event)}>
        <div className="page-hero">
          <h2>{pendingReceive ? "عملية استلام غير مؤكدة" : "إذن استلام جديد"}</h2>
          <button type="button" className="secondary" onClick={() => intakeFeedback.reveal()}>إضافة منتج جديد</button>
        </div>
        {pendingReceive ? (
          <p className="muted" data-testid="pending-operation">
            معرّف العملية محفوظ لهذه الجلسة. التحقق من النتيجة يتم عبر الخادم ولا يبدأ إذناً جديداً.
          </p>
        ) : null}
        <div className="field">
          <label htmlFor="receiptDate">تاريخ الاستلام</label>
          <input
            id="receiptDate"
            type="date"
            value={receiptDate}
            onChange={(event) => setReceiptDate(event.target.value)}
            required
            disabled={formLocked}
          />
        </div>
        {desktop ? (
          <MerchandiseFilters
            idPrefix="receipt-browse"
            categories={categories}
            categoryId={receiptBrowseCategoryId}
            query={receiptBrowseQuery}
            matched={matchedProducts(products, categories, receiptBrowseCategoryId, receiptBrowseQuery).length}
            total={products.length}
            onCategoryId={setReceiptBrowseCategoryId}
            onQuery={setReceiptBrowseQuery}
            onClear={() => { setReceiptBrowseCategoryId(""); setReceiptBrowseQuery(""); }}
          />
        ) : null}
        {lines.map((line, index) => {
          const product = products.find((item) => item.id === line.productId);
          return (
            <div className="variant-row receipt-variant-row" key={line.key}>
              <div className="field">
                <label htmlFor={`product-${line.key}`}>المنتج</label>
                <select
                  id={`product-${line.key}`}
                  value={line.productId}
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = { ...line, productId: event.target.value, variantId: "" };
                    setLines(next);
                  }}
                  disabled={formLocked}
                >
                  <option value="">اختر منتجاً</option>
                  <ProductChoiceOptions
                    products={products}
                    categories={categories}
                    desktop={desktop}
                    categoryId={receiptBrowseCategoryId}
                    query={receiptBrowseQuery}
                    selectedId={line.productId}
                  />
                </select>
                {product ? <p className="category-path">المسار: {categoryPath(categories, product.category.id) || product.category.nameAr}</p> : null}
              </div>
              <div className="field">
                <label htmlFor={`variant-${line.key}`}>المقاس واللون</label>
                <select
                  id={`variant-${line.key}`}
                  value={line.variantId}
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = { ...line, variantId: event.target.value };
                    setLines(next);
                  }}
                  disabled={formLocked || !product}
                >
                  <option value="">اختر المقاس واللون</option>
                  {product?.variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.size.nameAr} / {variant.color.nameAr}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`qty-${line.key}`}>الكمية</label>
                <input
                  id={`qty-${line.key}`}
                  inputMode="numeric"
                  value={line.quantity}
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = { ...line, quantity: event.target.value };
                    setLines(next);
                  }}
                  required
                  disabled={formLocked}
                />
              </div>
              <div className="field">
                <label htmlFor={`cost-${line.key}`}>تكلفة الشراء للجنيه</label>
                <input
                  id={`cost-${line.key}`}
                  value={line.costEgp}
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = { ...line, costEgp: event.target.value };
                    setLines(next);
                  }}
                  required
                  disabled={formLocked}
                />
              </div>
              <button
                type="button"
                className="secondary"
                disabled={formLocked || lines.length <= 1}
                onClick={() => setLines(lines.filter((item) => item.key !== line.key))}
              >
                حذف الصنف
              </button>
            </div>
          );
        })}
        <div className="actions">
          <button type="button" className="secondary" disabled={formLocked} onClick={() => setLines([...lines, emptyLine()])}>
            إضافة صنف
          </button>
          {pendingReceive ? (
            <button
              type="button"
              className="secondary"
              disabled={pending === "check" || pending === "receive"}
              onClick={() => void onCheckResult()}
            >
              {pending === "check" ? "جارٍ التحقق…" : "التحقق من النتيجة"}
            </button>
          ) : null}
          <button type="submit" className="business-primary-action" disabled={pending === "receive"}>
            {pending === "receive"
              ? "جارٍ الحفظ…"
              : pendingReceive
                ? "إعادة المحاولة"
                : "حفظ الاستلام"}
          </button>
        </div>
      </form>

      <section className="card" aria-label="تجهيز تصنيفات المخزون">
        <details className="business-disclosure">
        <summary>تجهيز التصنيف والمقاس واللون</summary>
        <p className="muted">إذا كان أحد الاختيارات غير موجود، أضفه هنا ثم استخدمه في المنتج.</p>
        <div className="grid two">
          <form aria-label="إضافة تصنيف للمخزون" onSubmit={(event) => void addTaxonomy(event, "category")}>
            <div className="field"><label htmlFor="intakeCategoryName">تصنيف جديد</label><input id="intakeCategoryName" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} required /></div>
            <div className="field"><label htmlFor="intakeCategoryParent">التصنيف الرئيسي (اختياري)</label><select id="intakeCategoryParent" value={categoryParentId} onChange={(event) => setCategoryParentId(event.target.value)}><option value="">تصنيف رئيسي</option>{categories.filter((item) => item.parentId === null).map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></div>
            <button type="submit" disabled={Boolean(pending)}>{pending === "taxonomy-category" ? "جارٍ الحفظ…" : "إضافة التصنيف"}</button>
          </form>
          <form aria-label="إضافة مقاس للمخزون" onSubmit={(event) => void addTaxonomy(event, "size")}>
            <div className="field"><label htmlFor="intakeSizeName">مقاس جديد</label><input id="intakeSizeName" value={sizeName} onChange={(event) => setSizeName(event.target.value)} required /></div>
            <button type="submit" disabled={Boolean(pending)}>{pending === "taxonomy-size" ? "جارٍ الحفظ…" : "إضافة المقاس"}</button>
          </form>
          <form aria-label="إضافة لون للمخزون" onSubmit={(event) => void addTaxonomy(event, "color")}>
            <div className="field"><label htmlFor="intakeColorName">لون جديد</label><input id="intakeColorName" value={colorName} onChange={(event) => setColorName(event.target.value)} required /></div>
            <button type="submit" disabled={Boolean(pending)}>{pending === "taxonomy-color" ? "جارٍ الحفظ…" : "إضافة اللون"}</button>
          </form>
        </div>
        </details>
      </section>

      <form ref={intakeFeedback.regionRef} className={`card stacked-form reveal-feedback${intakeFeedback.highlighted ? " is-highlighted" : ""}`} aria-label="إضافة منتج إلى المخزون" aria-busy={pending === "new-product"} onSubmit={(event) => void onCreateAndReceive(event)}>
        <h2 ref={intakeFeedback.headingRef} tabIndex={-1}>إضافة منتج أو تركيبة إلى المخزون</h2>
        <p className="muted">سجّل المنتج أو مقاساً ولوناً جديدين له مع الكمية وتكلفة الشراء. يُحفظ المنتج أولاً ثم إذن الاستلام؛ إذا توقف الاتصال بين الخطوتين، استعد الرمز وأكمل الاستلام.</p>
        <fieldset>
          <legend>نوع الإضافة</legend>
          <label><input type="radio" name="inventory-intake-mode" checked={intakeMode === "new"} disabled={Boolean(savedNewReceipt) || Boolean(pending)} onChange={() => { setIntakeMode("new"); setNewInventoryProduct(emptyNewInventoryProduct()); }} /> منتج جديد</label>
          <label><input type="radio" name="inventory-intake-mode" checked={intakeMode === "existing"} disabled={Boolean(savedNewReceipt) || Boolean(pending)} onChange={() => { setIntakeMode("existing"); setNewInventoryProduct(emptyNewInventoryProduct()); }} /> مقاس ولون جديدان لمنتج موجود</label>
        </fieldset>
        {intakeMode === "existing" ? <>
          {desktop ? (
            <MerchandiseFilters
              idPrefix="intake-browse"
              categories={categories}
              categoryId={intakeBrowseCategoryId}
              query={intakeBrowseQuery}
              matched={matchedProducts(products, categories, intakeBrowseCategoryId, intakeBrowseQuery).length}
              total={products.length}
              onCategoryId={setIntakeBrowseCategoryId}
              onQuery={setIntakeBrowseQuery}
              onClear={() => { setIntakeBrowseCategoryId(""); setIntakeBrowseQuery(""); }}
            />
          ) : null}
          <div className="field">
          <label htmlFor="existingInventoryProduct">اختر المنتج الموجود برمزه</label>
          <select id="existingInventoryProduct" value={selectedExistingProduct?.id ?? ""} disabled={Boolean(savedNewReceipt) || Boolean(pending)} onChange={(event) => {
            const selected = products.find((item) => item.id === event.target.value);
            setNewInventoryProduct(selected ? { code: selected.code, nameAr: selected.nameAr, categoryId: selected.category.id, defaultEgp: piastersToEgpInput(selected.defaultSellingPricePiasters), variants: [emptyNewInventoryVariant()] } : emptyNewInventoryProduct());
          }} required>
            <option value="">اختر المنتج</option>
            <ProductChoiceOptions
              products={products}
              categories={categories}
              desktop={desktop}
              categoryId={intakeBrowseCategoryId}
              query={intakeBrowseQuery}
              selectedId={selectedExistingProduct?.id ?? ""}
            />
          </select>
          {selectedExistingProduct ? <p className="category-path">المسار: {categoryPath(categories, selectedExistingProduct.category.id) || selectedExistingProduct.category.nameAr}</p> : null}
        </div>
        </> : null}
        {savedNewProduct ? <p className="notice" role="status">المنتج محفوظ: {savedNewProduct.code}. أكمل تسجيل الكمية لهذا المنتج دون إنشائه مرة أخرى.</p> : null}
        <div className="field"><label htmlFor="newInventoryReceiptDate">تاريخ الاستلام</label><input id="newInventoryReceiptDate" type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} disabled={Boolean(savedNewReceipt) || Boolean(pending)} required /></div>
        <div className="grid two">
          <div className="field">
            <label htmlFor="newInventoryCode">رمز المنتج / SKU</label>
            <input id="newInventoryCode" value={newInventoryProduct.code} onChange={(event) => setNewInventoryProduct((current) => ({ ...current, code: event.target.value }))} disabled={intakeMode === "existing" || Boolean(savedNewReceipt) || Boolean(pending)} required />
          </div>
          <div className="field">
            <label htmlFor="newInventoryName">اسم المنتج</label>
            <input id="newInventoryName" value={newInventoryProduct.nameAr} onChange={(event) => setNewInventoryProduct((current) => ({ ...current, nameAr: event.target.value }))} disabled={intakeMode === "existing" || Boolean(savedNewReceipt) || Boolean(pending)} required />
          </div>
          <div className="field">
            <label htmlFor="newInventoryCategory">التصنيف</label>
            <select id="newInventoryCategory" value={newInventoryProduct.categoryId} onChange={(event) => setNewInventoryProduct((current) => ({ ...current, categoryId: event.target.value }))} disabled={intakeMode === "existing" || Boolean(savedNewReceipt) || Boolean(pending)} required>
              <option value="">اختر تصنيفاً</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{categoryPath(categories, category.id) || category.nameAr}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="newInventoryPrice">سعر البيع الافتراضي بالجنيه</label>
            <input id="newInventoryPrice" inputMode="decimal" value={newInventoryProduct.defaultEgp} onChange={(event) => setNewInventoryProduct((current) => ({ ...current, defaultEgp: event.target.value }))} disabled={intakeMode === "existing" || Boolean(savedNewReceipt) || Boolean(pending)} required />
          </div>
        </div>
        <fieldset className="grant-editor">
          <legend>المقاسات والألوان والكميات</legend>
          {newInventoryProduct.variants.map((row, index) => <div className="variant-row intake-variant-row" key={row.key}>
            <div className="field"><label htmlFor={`new-size-${row.key}`}>المقاس</label><select id={`new-size-${row.key}`} value={row.sizeId} onChange={(event) => setNewInventoryProduct((current) => ({ ...current, variants: current.variants.map((item) => item.key === row.key ? { ...item, sizeId: event.target.value } : item) }))} disabled={Boolean(savedNewReceipt) || Boolean(pending)} required><option value="">اختر مقاساً</option>{sizes.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></div>
            <div className="field"><label htmlFor={`new-color-${row.key}`}>اللون</label><select id={`new-color-${row.key}`} value={row.colorId} onChange={(event) => setNewInventoryProduct((current) => ({ ...current, variants: current.variants.map((item) => item.key === row.key ? { ...item, colorId: event.target.value } : item) }))} disabled={Boolean(savedNewReceipt) || Boolean(pending)} required><option value="">اختر لوناً</option>{colors.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></div>
            <div className="field"><label htmlFor={`new-qty-${row.key}`}>الكمية</label><input id={`new-qty-${row.key}`} type="number" min="1" step="1" value={row.quantity} onChange={(event) => setNewInventoryProduct((current) => ({ ...current, variants: current.variants.map((item) => item.key === row.key ? { ...item, quantity: event.target.value } : item) }))} disabled={Boolean(savedNewReceipt) || Boolean(pending)} required /></div>
            <div className="field"><label htmlFor={`new-cost-${row.key}`}>تكلفة الشراء بالجنيه</label><input id={`new-cost-${row.key}`} inputMode="decimal" value={row.costEgp} onChange={(event) => setNewInventoryProduct((current) => ({ ...current, variants: current.variants.map((item) => item.key === row.key ? { ...item, costEgp: event.target.value } : item) }))} disabled={Boolean(savedNewReceipt) || Boolean(pending)} required /></div>
            <button type="button" className="secondary" disabled={Boolean(savedNewReceipt) || Boolean(pending) || newInventoryProduct.variants.length <= 1} onClick={() => setNewInventoryProduct((current) => ({ ...current, variants: current.variants.filter((item) => item.key !== row.key) }))}>حذف التركيبة {index + 1}</button>
          </div>)}
          <button type="button" className="secondary" disabled={Boolean(savedNewReceipt) || Boolean(pending)} onClick={() => setNewInventoryProduct((current) => ({ ...current, variants: [...current.variants, emptyNewInventoryVariant()] }))}>إضافة مقاس ولون</button>
        </fieldset>
        <div className="actions">
          <button type="submit" disabled={Boolean(pending) || !branchId}>{pending === "new-product" ? "جارٍ الحفظ…" : savedNewProduct ? "حفظ كمية المنتج" : intakeMode === "existing" ? "حفظ التركيبة والكمية" : "حفظ المنتج والكمية"}</button>
          {savedNewReceipt && pendingReceive?.phase === "rejected" ? <button type="button" className="secondary" disabled={Boolean(pending)} onClick={() => { setSavedNewReceipt(null); setError(""); setNotice("راجع تاريخ الاستلام والفرع والكميات والتكلفة، ثم احفظ الكمية للمنتج المحفوظ."); }}>تعديل بيانات الاستلام المرفوض</button> : null}
          {!savedNewReceipt ? <button type="button" className="secondary" disabled={Boolean(pending) || !newInventoryProduct.code.trim()} onClick={() => void recoverNewInventoryProduct()}>استعادة منتج محفوظ برمزه</button> : null}
        </div>
      </form>

      <div className="grid two">
        <section className="card" aria-label="المخزون المنخفض">
          <h2>المخزون المنخفض</h2>
          {lowStock.length === 0 ? (
            <EmptyState title="المخزون كويس" message="مفيش أصناف وصلت لحد التنبيه." />
          ) : (
            <div className="staff-list" data-testid="low-stock-list">
              {lowStock.map((item) => (
                <article className="staff-item" key={`${item.branchId}:${item.variantId}`}>
                  <p>
                    {item.variant.product.code} / {item.variant.size.nameAr} / {item.variant.color.nameAr}
                  </p>
                  <p>الفرع: {workspace.authorizedBranches.find((branch) => branch.id === item.branchId)?.nameAr ?? item.branchId} — المتاح: {item.availableQuantity} — الحد: {item.threshold}</p>
                </article>
              ))}
            </div>
          )}
          <details className="business-disclosure">
            <summary>إعدادات التنبيه</summary>
            <form aria-label="حد التنبيه العام" onSubmit={(event) => void onSaveThreshold(event)}>
              <div className="field">
                <label htmlFor="globalThreshold">الحد العام للكمية المتاحة</label>
                <input id="globalThreshold" value={thresholdInput} onChange={(event) => setThresholdInput(event.target.value)} />
              </div>
              <button type="submit" disabled={pending === "settings"}>
                {pending === "settings" ? "جارٍ الحفظ…" : "حفظ الحد العام"}
              </button>
            </form>
            {settings ? <p className="muted">الحد الحالي: {settings.lowStockThreshold}</p> : null}
            <form className="stacked-form" aria-label="حد تنبيه لمتغير" onSubmit={(event) => void onSaveOverride(event)}>
              <div className="field">
                <label htmlFor="overrideVariant">المقاس واللون</label>
                <select id="overrideVariant" value={overrideVariantId} onChange={(event) => setOverrideVariantId(event.target.value)}>
                  <option value="">اختر المقاس واللون</option>
                  {variantOptions.map((item) => (
                    <option key={item.variant.id} value={item.variant.id}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="overrideThreshold">حد المقاس واللون (فارغ للحذف)</label>
                <input id="overrideThreshold" value={overrideThreshold} onChange={(event) => setOverrideThreshold(event.target.value)} />
              </div>
              <button type="submit" disabled={pending === "override"}>
                {pending === "override" ? "جارٍ الحفظ…" : "حفظ حد المقاس واللون"}
              </button>
            </form>
          </details>
        </section>
        <section className="card">
          <h2>تنبيه</h2>
          <p>
            الاستلام متصل ويتطلب صلاحية المدير. كل فرع له رصيد مستقل، وتبقى تكاليف الشراء في دفعات منفصلة.
          </p>
        </section>
      </div>

      <div className="grid two">
        <section className="card" aria-label="سجل الاستلام">
          {receipts.length === 0 ? (
            <EmptyState title="لسه مفيش استلام" message="سجّل أول إذن من النموذج فوق." />
          ) : (
            <details className="business-disclosure">
              <summary>سجل الاستلام</summary>
              <div className="business-archive-scroll" role="region" aria-label="سجل الاستلام" tabIndex={0}>
                <div className="staff-list" data-testid="receipt-list">
                  {receipts.map((receipt) => (
                    <article className="staff-item business-archive-row" key={receipt.id}>
                      <button type="button" className="secondary" disabled={Boolean(detailLoadingId)} aria-busy={detailLoadingId === receipt.id} onClick={() => void openReceiptDetails(receipt.id)}>
                        {detailLoadingId === receipt.id ? "جارٍ تحميل التفاصيل…" : "عرض التفاصيل"}
                      </button>
                      <p>التاريخ: {receipt.receiptDate} · الفرع: {workspace.authorizedBranches.find((branch) => branch.id === receipt.branchId)?.nameAr ?? receipt.branchId}</p>
                      <p>{receipt.lines.map((line) => line.variant.product.code).join("، ")}</p>
                      <p className="muted">أصناف: {receipt.lines.length}</p>
                    </article>
                  ))}
                </div>
              </div>
            </details>
          )}
          {selectedReceipt ? (
            <section ref={receiptFeedback.regionRef} className={`reveal-feedback${receiptFeedback.highlighted ? " is-highlighted" : ""}`} data-testid="receipt-details">
              <h3 ref={receiptFeedback.headingRef} tabIndex={-1}>تفاصيل الإذن</h3>
              <p>تاريخ الاستلام: {selectedReceipt.receiptDate}</p>
              <p>الفرع: {workspace.authorizedBranches.find((branch) => branch.id === selectedReceipt.branchId)?.nameAr ?? "فرع غير متاح"}</p>
              {selectedReceipt.lines.map((line) => (
                <div key={line.id} className="staff-item">
                  <p>{line.variant.product.nameAr} — {line.variant.product.code} / {line.variant.size.nameAr} / {line.variant.color.nameAr}</p>
                  <p>الكمية المستلمة: {line.effectiveQuantity} — تكلفة شراء الوحدة: {formatEgpFromPiasters(line.effectiveUnitCostPiasters)}</p>
                  <p className="muted">المتبقي بالمخزون بكل الفروع: {line.remainingQuantity} — المستهلك حالياً: {line.allocatedQuantity}</p>
                </div>
              ))}
              <div className="actions">
                <button type="button" className="secondary" onClick={beginCorrection}>تصحيح الإذن</button>
              </div>
              {editingCorrection ? (
                <form ref={correctionFeedback.regionRef} className={`stacked-form reveal-feedback${correctionFeedback.highlighted ? " is-highlighted" : ""}`} aria-label="تصحيح إذن الاستلام" onSubmit={(event) => void onCorrectReceipt(event)}>
                  <h4 ref={correctionFeedback.headingRef} tabIndex={-1}>تصحيح إذن الاستلام</h4>
                  <div className="field">
                    <label htmlFor="receivingCorrectionReason">سبب التصحيح</label>
                    <input
                      id="receivingCorrectionReason"
                      value={correctionReason}
                      onChange={(event) => {
                        resetCorrectionAttempt();
                        setCorrectionReason(event.target.value);
                      }}
                      required
                    />
                  </div>
                  {correctionLines.map((line, index) => (
                    <div className="variant-row" key={line.lineId}>
                      <p>{line.label}</p>
                      <div className="field">
                        <label htmlFor={`correctionQuantity-${line.lineId}`}>الكمية</label>
                        <input
                          id={`correctionQuantity-${line.lineId}`}
                          inputMode="numeric"
                          value={line.quantity}
                          onChange={(event) => {
                            resetCorrectionAttempt();
                            const next = [...correctionLines];
                            next[index] = { ...line, quantity: event.target.value };
                            setCorrectionLines(next);
                          }}
                          required
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`correctionCost-${line.lineId}`}>تكلفة الشراء بالجنيه</label>
                        <input
                          id={`correctionCost-${line.lineId}`}
                          value={line.costEgp}
                          onChange={(event) => {
                            resetCorrectionAttempt();
                            const next = [...correctionLines];
                            next[index] = { ...line, costEgp: event.target.value };
                            setCorrectionLines(next);
                          }}
                          required
                        />
                      </div>
                    </div>
                  ))}
                  <div className="actions">
                    <button type="submit" disabled={pending === "correction"}>
                      {pending === "correction"
                        ? "جارٍ الحفظ…"
                        : correctionRetryReady
                          ? "إعادة محاولة التصحيح"
                          : "حفظ التصحيح"}
                    </button>
                    <button type="button" className="secondary" onClick={() => {
                      resetCorrectionAttempt();
                      setEditingCorrection(false);
                    }}>إلغاء</button>
                  </div>
                </form>
              ) : null}
              {selectedReceipt.corrections.length > 0 ? (
                <div className="staff-list">
                  <h4>سجل التصحيحات</h4>
                  {selectedReceipt.corrections.map((correction) => (
                    <details className="staff-item" key={correction.id}>
                      <summary>التصحيح {correction.revision}: {correction.reason}</summary>
                      <p className="muted">نفّذه {correction.changedByDisplayName} — {new Date(correction.changedAt).toLocaleString("ar-EG")}</p>
                      {correction.lines.map((change) => {
                        const line = selectedReceipt.lines.find((item) => item.id === change.lineId);
                        return (
                          <div key={change.lineId}>
                            <p>{line ? `${line.variant.product.nameAr} — ${line.variant.product.code} / ${line.variant.size.nameAr} / ${line.variant.color.nameAr}` : "صنف الاستلام"}</p>
                            <p>عند تسجيل الإذن: {change.originalQuantity} × {formatEgpFromPiasters(change.originalUnitCostPiasters)}</p>
                            <p>قبل التصحيح: {change.previousQuantity} × {formatEgpFromPiasters(change.previousUnitCostPiasters)}</p>
                            <p>بعد التصحيح: {change.effectiveQuantity} × {formatEgpFromPiasters(change.effectiveUnitCostPiasters)}</p>
                          </div>
                        );
                      })}
                    </details>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </section>

        <section className="card" aria-label="تفاصيل دفعات الشراء">
          {batches.length === 0 ? (
            <EmptyState title="لسه مفيش دفعات" message="بعد أول استلام هتظهر هنا." />
          ) : (
            <details className="business-disclosure">
              <summary>تفاصيل دفعات الشراء</summary>
              <div className="business-archive-scroll" role="region" aria-label="تفاصيل دفعات الشراء" tabIndex={0}>
                <div className="staff-list" data-testid="batch-list">
                  {batches.map((batch) => (
                    <article className="staff-item business-archive-row" key={batch.id}>
                      <p>
                        {batch.variant.product.nameAr} — {batch.variant.product.code} / {batch.variant.size.nameAr} / {batch.variant.color.nameAr}
                      </p>
                      <p>المتبقي بالمخزون: {batch.remainingQuantity} · حسب الفرع: {batch.branchBalances.map((balance) => `${workspace.authorizedBranches.find((branch) => branch.id === balance.branchId)?.nameAr ?? "فرع غير متاح"}: ${balance.availableQuantity}`).join("، ")}</p>
                      <p>تكلفة شراء الوحدة: {formatEgpFromPiasters(batch.effectiveUnitCostPiasters)}</p>
                    </article>
                  ))}
                </div>
              </div>
            </details>
          )}
        </section>
      </div>

    </main>
  );
}
