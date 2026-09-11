import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CashierProductLookupDto, CashierVariantDto, SaleDto, WorkspaceDto } from "@bravos/contracts";
import { SaleSummary } from "./SaleSummary.tsx";
import { ApiError, completeSale, lookupProductByCode, lookupSaleOperation, prepareSale, signOut } from "../api.ts";
import { egpInputToPiasters, formatEgpFromPiasters } from "../money.ts";
import {
  assignPendingSale,
  clearPendingSale,
  createPendingSale,
  digestSalePayload,
  loadPendingSale,
  pendingSaleStorageKey,
  savePendingSale,
  withPendingSaleLock,
  type PendingSale,
  type SalePayload,
} from "../sales-pending.ts";

function saleWriteFromRecord(sale: SaleDto, occurredAt: string | null) {
  return {
    saleId: sale.id,
    operationId: sale.operationId,
    customerName: sale.customerName,
    customerPhone: sale.customerPhone,
    employeeDiscountPiasters: sale.employeeDiscountPiasters,
    discountReason: sale.discountReason,
    occurredAt,
    lines: sale.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
  };
}

type CartLine = {
  key: string;
  product: CashierProductLookupDto;
  variant: CashierVariantDto;
  quantity: number;
};

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
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");
  const [product, setProduct] = useState<CashierProductLookupDto | null>(null);
  const [sizeId, setSizeId] = useState("");
  const [colorId, setColorId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discountEgp, setDiscountEgp] = useState("0");
  const [discountReason, setDiscountReason] = useState("");
  const [quote, setQuote] = useState<SaleDto | null>(null);
  const [completed, setCompleted] = useState<SaleDto | null>(null);
  const [handedOver, setHandedOver] = useState(false);
  const [pendingSale, setPendingSale] = useState<PendingSale | null>(null);
  const [frozenPayload, setFrozenPayload] = useState<SalePayload | null>(null);
  const inFlightRef = useRef(false);
  const pendingSaleRef = useRef<PendingSale | null>(null);
  const frozenPayloadRef = useRef<SalePayload | null>(null);
  const submittedRef = useRef<PendingSale | null>(null);
  const invalidationTailRef = useRef(Promise.resolve());
  const revisionBlockRef = useRef(false);
  const localIdentityRef = useRef<{ saleId: string; operationId: string } | null>(null);
  const foreignRecoveryRef = useRef<PendingSale | null>(null);
  const cartRef = useRef<CartLine[]>([]);
  const revisionEpochRef = useRef(0);
  const submitEpochRef = useRef(0);
  const [revisionBlock, setRevisionBlock] = useState(false);
  const [foreignRecovery, setForeignRecovery] = useState<PendingSale | null>(null);
  cartRef.current = cart;

  useEffect(() => {
    const stored = loadPendingSale(workspace.staff.id);
    if (!stored) {
      return;
    }
    pendingSaleRef.current = stored;
    setPendingSale(stored);
    if (stored.payload) {
      frozenPayloadRef.current = stored.payload;
      setFrozenPayload(stored.payload);
      setCustomerName(stored.payload.customerName ?? "");
      setCustomerPhone(stored.payload.customerPhone ?? "");
      setDiscountEgp((stored.payload.employeeDiscountPiasters / 100).toString());
      setDiscountReason(stored.payload.discountReason ?? "");
    }
    let cancelled = false;
    inFlightRef.current = true;
    setPending("check");
    lookupSaleOperation(stored.operationId)
      .then(async (found) => {
        if (cancelled) {
          return;
        }
        if (found?.physicallyCompleted) {
          await acceptSale(found, "تم العثور على البيع المحفوظ.");
          return;
        }
        if (stored.physicallyCompleted) {
          setHandedOver(true);
          setError("تم تسليم البضاعة واستلام النقد. لا تطلب الدفع مرة أخرى. أعد المحاولة لحفظ البيع.");
          if (found && !found.physicallyCompleted) {
            setQuote(found);
            const recovered = await completeSale(saleWriteFromRecord(found, stored.occurredAt));
            if (!cancelled && recovered.physicallyCompleted) {
              await acceptSale(recovered, "تم حفظ البيع النقدي.");
            }
          }
          return;
        }
        if (found && !found.physicallyCompleted) {
          setQuote(found);
          const prepared: PendingSale = { ...stored, phase: "prepared" };
          pendingSaleRef.current = prepared;
          setPendingSale(prepared);
          setNotice("تم استعادة الأسعار المقبولة. يمكنك التعديل أو تأكيد التسليم.");
          return;
        }
        if (stored.phase === "uncertain") {
          setError("لم يُؤكد حفظ البيع بعد. أدخل البيانات نفسها ثم أعد المحاولة.");
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.messageAr : "تعذر التحقق من البيع.");
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
      if (event.key !== pendingSaleStorageKey(workspace.staff.id)) {
        return;
      }
      if (pendingSaleRef.current) {
        return;
      }
      const stored = loadPendingSale(workspace.staff.id);
      if (!stored || (!stored.physicallyCompleted && stored.phase !== "uncertain")) {
        return;
      }
      if (cartRef.current.length > 0 || localIdentityRef.current) {
        foreignRecoveryRef.current = stored;
        setForeignRecovery(stored);
        return;
      }
      pendingSaleRef.current = stored;
      setPendingSale(stored);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [workspace.staff.id]);

  async function logout() {
    await signOut();
    onChanged(null);
    navigate("/login");
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending("search");
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
      setPending("");
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

  function addSelected() {
    if (!product || !selected) {
      return;
    }
    if (!beginCartRevision()) {
      return;
    }
    setCart((current) => {
      const existing = current.find((line) => line.variant.id === selected.id);
      if (existing) {
        return current.map((line) =>
          line.variant.id === selected.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...current, { key: crypto.randomUUID(), product, variant: selected, quantity: 1 }];
    });
  }

  function updateQuantity(key: string, quantity: number) {
    if (!beginCartRevision()) {
      return;
    }
    if (quantity < 1) {
      setCart((current) => current.filter((line) => line.key !== key));
      return;
    }
    setCart((current) => current.map((line) => (line.key === key ? { ...line, quantity } : line)));
  }

  function parsePayload(): SalePayload | null {
    if (cart.length === 0) {
      setError("أضف صنفاً إلى السلة أولاً.");
      return null;
    }
    const discountPiasters = egpInputToPiasters(discountEgp);
    if (discountPiasters === null) {
      setError("قيمة الخصم غير صالحة.");
      return null;
    }
    return {
      customerName: customerName.trim() || null,
      customerPhone: customerPhone.trim() || null,
      employeeDiscountPiasters: discountPiasters,
      discountReason: discountReason.trim() || null,
      lines: cart.map((line) => ({ variantId: line.variant.id, quantity: line.quantity })),
    };
  }

  function formIsFrozen() {
    const current = pendingSaleRef.current;
    return Boolean(current && (current.physicallyCompleted || current.phase === "uncertain"));
  }

  function beginCartRevision() {
    if (inFlightRef.current || formIsFrozen()) {
      return false;
    }
    revisionEpochRef.current += 1;
    revisionBlockRef.current = true;
    setRevisionBlock(true);
    frozenPayloadRef.current = null;
    setFrozenPayload(null);
    setQuote(null);
    setHandedOver(false);
    const expectedId = pendingSaleRef.current?.saleId ?? null;
    invalidationTailRef.current = invalidationTailRef.current.then(() => abandonPreparedQuote(expectedId));
    return true;
  }

  async function abandonPreparedQuote(expectedSaleId?: string | null) {
    const current = pendingSaleRef.current;
    const targetId = expectedSaleId ?? current?.saleId ?? null;
    if (!current || !targetId || current.saleId !== targetId) {
      return;
    }
    if (current.physicallyCompleted || current.phase === "uncertain") {
      return;
    }
    await withPendingSaleLock(workspace.staff.id, () => {
      clearPendingSale(workspace.staff.id, targetId);
    });
    if (pendingSaleRef.current?.saleId !== targetId) {
      return;
    }
    if (pendingSaleRef.current.physicallyCompleted || pendingSaleRef.current.phase === "uncertain") {
      return;
    }
    pendingSaleRef.current = null;
    submittedRef.current = null;
    frozenPayloadRef.current = null;
    localIdentityRef.current = null;
    setPendingSale(null);
    setFrozenPayload(null);
  }

  async function acceptSale(sale: SaleDto, messageAr: string) {
    await withPendingSaleLock(workspace.staff.id, () => {
      clearPendingSale(workspace.staff.id, sale.id);
    });
    const recoveringForeign = Boolean(foreignRecoveryRef.current && foreignRecoveryRef.current.saleId === sale.id);
    const recoveringLocal = Boolean(pendingSaleRef.current && pendingSaleRef.current.saleId === sale.id);
    if (recoveringForeign) {
      foreignRecoveryRef.current = null;
      setForeignRecovery(null);
    }
    if (recoveringLocal || !recoveringForeign) {
      pendingSaleRef.current = null;
      frozenPayloadRef.current = null;
      localIdentityRef.current = null;
      setPendingSale(null);
      setFrozenPayload(null);
      setQuote(null);
      setCart([]);
      setCustomerName("");
      setCustomerPhone("");
      setDiscountEgp("0");
      setDiscountReason("");
      setHandedOver(false);
      revisionBlockRef.current = false;
      setRevisionBlock(false);
    }
    if (recoveringForeign && !recoveringLocal) {
      setQuote(null);
      setHandedOver(false);
    }
    setCompleted(sale);
    setNotice(messageAr);
    setError("");
  }

  async function submit(kind: "prepare" | "complete") {
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setPending(kind);
    setError("");
    setNotice("");
    const epoch = revisionEpochRef.current;
    submitEpochRef.current = epoch;
    const physical = kind === "complete";
    if (physical && revisionBlockRef.current && !pendingSaleRef.current?.physicallyCompleted) {
      inFlightRef.current = false;
      setPending("");
      setError("أكد الأسعار بعد تعديل السلة قبل إتمام البيع.");
      return;
    }
    if (physical && !handedOver && !pendingSaleRef.current?.physicallyCompleted) {
      inFlightRef.current = false;
      setPending("");
      setError("أكد تسليم البضاعة واستلام النقد قبل إتمام البيع.");
      return;
    }
    const payload =
      physical && frozenPayloadRef.current
        ? frozenPayloadRef.current
        : parsePayload();
    if (!payload) {
      inFlightRef.current = false;
      setPending("");
      return;
    }
    try {
      await invalidationTailRef.current;
    } catch {
      inFlightRef.current = false;
      setPending("");
      setError("تعذر تجهيز عملية البيع.");
      return;
    }
    if (revisionEpochRef.current !== epoch) {
      inFlightRef.current = false;
      setPending("");
      setError("أكد الأسعار بعد تعديل السلة قبل إتمام البيع.");
      return;
    }
    if (physical && revisionBlockRef.current && !pendingSaleRef.current?.physicallyCompleted) {
      inFlightRef.current = false;
      setPending("");
      setError("أكد الأسعار بعد تعديل السلة قبل إتمام البيع.");
      return;
    }
    let local = pendingSaleRef.current;
    if (local && kind === "prepare" && local.phase === "rejected") {
      local = null;
    }
    if (!local) {
      const ids = localIdentityRef.current ?? {
        saleId: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
      };
      localIdentityRef.current = ids;
      local = {
        ...createPendingSale({
          staffId: workspace.staff.id,
          physicallyCompleted: physical,
          payload,
          occurredAt: null,
        }),
        saleId: ids.saleId,
        operationId: ids.operationId,
      };
    }
    submittedRef.current = local;
    if (physical && !local.occurredAt) {
      local = { ...local, occurredAt: new Date().toISOString(), physicallyCompleted: true, payload };
      submittedRef.current = local;
      pendingSaleRef.current = local;
      setPendingSale(local);
    }
    let digest: string;
    try {
      digest = await digestSalePayload(payload);
    } catch {
      setError("تعذر تجهيز عملية البيع.");
      inFlightRef.current = false;
      setPending("");
      return;
    }
    if (revisionEpochRef.current !== epoch) {
      inFlightRef.current = false;
      setPending("");
      setError("أكد الأسعار بعد تعديل السلة قبل إتمام البيع.");
      return;
    }
    try {
      const assignment = await withPendingSaleLock(workspace.staff.id, () =>
        assignPendingSale({
          staffId: workspace.staff.id,
          digest,
          localSaleId: local.saleId,
          localOperationId: local.operationId,
          physicallyCompleted: physical,
          payload,
          occurredAt: local.occurredAt,
        }),
      );
      if (assignment.kind === "blocked") {
        setError(
          assignment.pending.physicallyCompleted
            ? "تم تسليم البضاعة واستلام النقد. لا تطلب الدفع مرة أخرى. تحقق من النتيجة أو أعد المحاولة بنفس البيانات."
            : "توجد عملية بيع غير مؤكدة. تحقق من نتيجتها قبل بدء بيع جديد.",
        );
        submittedRef.current = local;
        localIdentityRef.current = { saleId: local.saleId, operationId: local.operationId };
        foreignRecoveryRef.current = assignment.pending;
        setForeignRecovery(assignment.pending);
        if (local.physicallyCompleted) {
          pendingSaleRef.current = local;
          setPendingSale(local);
        } else {
          pendingSaleRef.current = null;
        }
        return;
      }
      const nextPending = assignment.pending;
      pendingSaleRef.current = nextPending;
      submittedRef.current = nextPending;
      setPendingSale(nextPending);
      frozenPayloadRef.current = payload;
      setFrozenPayload(payload);
      const body = {
        saleId: nextPending.saleId,
        operationId: nextPending.operationId,
        occurredAt: nextPending.occurredAt,
        ...payload,
      };
      const result = kind === "prepare" ? await prepareSale(body) : await completeSale(body);
      if (revisionEpochRef.current !== epoch) {
        setError("أكد الأسعار بعد تعديل السلة قبل إتمام البيع.");
        revisionBlockRef.current = true;
        setRevisionBlock(true);
        setQuote(null);
        return;
      }
      if (result.physicallyCompleted) {
        await acceptSale(result, kind === "complete" ? "تم حفظ البيع النقدي." : "تم العثور على البيع المحفوظ.");
        return;
      }
      const prepared: PendingSale = { ...nextPending, phase: "prepared", payload };
      pendingSaleRef.current = prepared;
      await withPendingSaleLock(workspace.staff.id, () => {
        const stored = loadPendingSale(workspace.staff.id);
        if (stored && stored.saleId !== prepared.saleId) {
          return;
        }
        savePendingSale(prepared);
      });
      setPendingSale(prepared);
      setQuote(result);
      revisionBlockRef.current = false;
      setRevisionBlock(false);
      setNotice("تم قبول الأسعار من الخادم. يمكنك تعديل السلة أو تأكيد التسليم والدفع.");
    } catch (caught) {
      const current = submittedRef.current ?? pendingSaleRef.current;
      if (caught instanceof ApiError && caught.status === 409) {
        const found = await lookupSaleOperation(current?.operationId ?? "");
        if (found?.physicallyCompleted) {
          await acceptSale(found, "تم العثور على البيع المحفوظ.");
          return;
        }
      }
      if (caught instanceof ApiError && (caught.status === 400 || caught.status === 404) && current && !current.physicallyCompleted) {
        const rejected: PendingSale = { ...current, phase: "rejected", digest: null };
        await withPendingSaleLock(workspace.staff.id, () => {
          const stored = loadPendingSale(workspace.staff.id);
          if (stored && stored.saleId !== rejected.saleId) {
            return;
          }
          savePendingSale(rejected);
        });
        pendingSaleRef.current = rejected;
        submittedRef.current = rejected;
        frozenPayloadRef.current = null;
        setPendingSale(rejected);
        setFrozenPayload(null);
        setError(caught.messageAr);
        return;
      }
      if (current) {
        const uncertain: PendingSale = {
          ...current,
          phase: "uncertain",
          digest,
          physicallyCompleted: physical || current.physicallyCompleted,
          payload,
        };
        await withPendingSaleLock(workspace.staff.id, () => {
          const stored = loadPendingSale(workspace.staff.id);
          if (stored && stored.saleId !== uncertain.saleId) {
            return;
          }
          savePendingSale(uncertain);
        });
        pendingSaleRef.current = uncertain;
        submittedRef.current = uncertain;
        setPendingSale(uncertain);
      }
      setError(
        physical || current?.physicallyCompleted
          ? "تم تسليم البضاعة واستلام النقد. لا تطلب الدفع مرة أخرى. أعد المحاولة لحفظ البيع."
          : caught instanceof ApiError
            ? caught.messageAr
            : "تعذر حفظ البيع.",
      );
    } finally {
      inFlightRef.current = false;
      setPending("");
    }
  }

  async function recoverOperation(current: PendingSale, adoptQuote: boolean) {
    const found = await lookupSaleOperation(current.operationId);
    if (found?.physicallyCompleted) {
      await acceptSale(found, "تم العثور على البيع المحفوظ.");
      return;
    }
    if (current.physicallyCompleted) {
      if (adoptQuote) {
        setHandedOver(true);
        setError("تم تسليم البضاعة واستلام النقد. لا تطلب الدفع مرة أخرى. أعد المحاولة لحفظ البيع.");
      }
      if (found && !found.physicallyCompleted) {
        if (adoptQuote) {
          setQuote(found);
        }
        const recovered = await completeSale(saleWriteFromRecord(found, current.occurredAt));
        if (recovered.physicallyCompleted) {
          await acceptSale(recovered, "تم حفظ البيع النقدي.");
        }
      } else if (!adoptQuote) {
        setError("تم تسليم البضاعة واستلام النقد. لا تطلب الدفع مرة أخرى. أعد المحاولة لحفظ البيع.");
      }
      return;
    }
    if (found && !found.physicallyCompleted) {
      if (!adoptQuote) {
        setError("توجد عملية بيع غير مؤكدة. تحقق من نتيجتها قبل بدء بيع جديد.");
        return;
      }
      setQuote(found);
      const prepared: PendingSale = { ...current, phase: "prepared" };
      pendingSaleRef.current = prepared;
      setPendingSale(prepared);
      setNotice("تم استعادة الأسعار المقبولة. يمكنك التعديل أو تأكيد التسليم.");
      return;
    }
    setError("لم يُؤكد الحفظ بعد. أعد المحاولة أو تحقق لاحقاً.");
  }

  async function onCheckResult() {
    const local = pendingSaleRef.current;
    const foreign = foreignRecoveryRef.current;
    if (inFlightRef.current || (!local && !foreign)) {
      return;
    }
    inFlightRef.current = true;
    setPending("check");
    setError("");
    try {
      if (local) {
        await recoverOperation(local, true);
        return;
      }
      if (foreign) {
        await recoverOperation(foreign, false);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر التحقق من البيع.");
    } finally {
      inFlightRef.current = false;
      setPending("");
    }
  }

  async function onCheckForeign() {
    const foreign = foreignRecoveryRef.current;
    if (!foreign || inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setPending("check");
    setError("");
    try {
      await recoverOperation(foreign, false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر التحقق من البيع.");
    } finally {
      inFlightRef.current = false;
      setPending("");
    }
  }

  const submitting = pending === "prepare" || pending === "complete" || pending === "check";
  const formLocked = Boolean(
    submitting || (pendingSale && (pendingSale.physicallyCompleted || pendingSale.phase === "uncertain")),
  );

  return (
    <main className="shell">
      <header className="brand">
        <div>
          <h1>البحث عن منتج</h1>
          <p className="muted">الفرع النشط: {workspace.activeBranch?.nameAr ?? "غير محدد"}</p>
        </div>
        <div className="actions">
          <Link className="button secondary" to="/sales">المبيعات</Link>
          <Link className="button secondary" to="/workspace">العودة لمساحة العمل</Link>
          <button className="secondary" type="button" onClick={() => void logout()}>
            تسجيل الخروج
          </button>
        </div>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}
      <form className="card" aria-label="البحث برمز المنتج" onSubmit={(event) => void onSearch(event)}>
        <div className="field">
          <label htmlFor="lookupCode">رمز المنتج</label>
          <input id="lookupCode" value={code} onChange={(event) => setCode(event.target.value)} required />
        </div>
        <button type="submit" disabled={Boolean(pending)}>
          {pending === "search" ? "جارٍ البحث…" : "بحث"}
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
              ) : (
                <button type="button" disabled={formLocked} onClick={addSelected}>إضافة إلى السلة</button>
              )}
            </div>
          ) : (
            <p className="muted">اختر المقاس واللون لعرض سعر البيع.</p>
          )}
        </section>
      ) : null}

      <form
        className="card"
        aria-label="إتمام البيع النقدي"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(handedOver || pendingSale?.physicallyCompleted ? "complete" : "prepare");
        }}
      >
        <h2>سلة البيع</h2>
        {cart.length === 0 ? (
          <p className="muted">لا توجد أصناف في السلة.</p>
        ) : (
          <ul data-testid="sale-cart">
            {cart.map((line) => (
              <li key={line.key}>
                <p>
                  {line.product.code} — {line.product.nameAr} / {line.variant.size.nameAr} / {line.variant.color.nameAr}
                </p>
                <p>سعر الوحدة: {formatEgpFromPiasters(line.variant.sellingPricePiasters)}</p>
                <div className="field">
                  <label htmlFor={`qty-${line.key}`}>الكمية</label>
                  <input
                    id={`qty-${line.key}`}
                    type="number"
                    min={1}
                    value={line.quantity}
                    disabled={formLocked}
                    onChange={(event) => updateQuantity(line.key, Number(event.target.value))}
                  />
                </div>
                <button type="button" className="secondary" disabled={formLocked} onClick={() => updateQuantity(line.key, 0)}>
                  حذف
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="field">
          <label htmlFor="customerName">اسم الزبون (اختياري)</label>
          <input id="customerName" value={customerName} disabled={formLocked} onChange={(event) => { if (beginCartRevision()) setCustomerName(event.target.value); }} />
        </div>
        <div className="field">
          <label htmlFor="customerPhone">هاتف الزبون (اختياري)</label>
          <input id="customerPhone" value={customerPhone} disabled={formLocked} onChange={(event) => { if (beginCartRevision()) setCustomerPhone(event.target.value); }} />
        </div>
        <div className="field">
          <label htmlFor="discountEgp">خصم الموظف بالجنيه</label>
          <input id="discountEgp" value={discountEgp} disabled={formLocked} onChange={(event) => { if (beginCartRevision()) setDiscountEgp(event.target.value); }} />
        </div>
        <div className="field">
          <label htmlFor="discountReason">سبب الخصم (اختياري)</label>
          <input id="discountReason" value={discountReason} disabled={formLocked} onChange={(event) => { if (beginCartRevision()) setDiscountReason(event.target.value); }} />
        </div>
        {quote ? (
          <section data-testid="accepted-prices">
            <h3>الأسعار المقبولة</h3>
            <p>الأصلي: {formatEgpFromPiasters(quote.originalTotalPiasters)}</p>
            <p>الخصم: {formatEgpFromPiasters(quote.employeeDiscountPiasters)}</p>
            <p>الإجمالي: {formatEgpFromPiasters(quote.finalTotalPiasters)}</p>
          </section>
        ) : null}
        <div className="field">
          <label htmlFor="handedOver">
            <input
              id="handedOver"
              type="checkbox"
              checked={handedOver || pendingSale?.physicallyCompleted === true}
              disabled={!quote && !pendingSale?.physicallyCompleted}
              onChange={(event) => setHandedOver(event.target.checked)}
            />
            {" "}استلم الزبون البضاعة ودفع نقداً
          </label>
        </div>
        <div className="actions">
          <button type="button" disabled={Boolean(pending) || cart.length === 0 || formLocked} onClick={() => void submit("prepare")}>
            {pending === "prepare" ? "جارٍ قبول الأسعار…" : "قبول الأسعار"}
          </button>
          {quote && !formLocked ? (
            <button type="button" className="secondary" onClick={() => beginCartRevision()}>
              إلغاء عرض السعر
            </button>
          ) : null}
          <button type="button" disabled={Boolean(pending) || revisionBlock || (!quote && !pendingSale?.physicallyCompleted)} onClick={() => void submit("complete")}>
            {pending === "complete" ? "جارٍ الحفظ…" : "إتمام البيع"}
          </button>
          {pendingSale ? (
            <>
              <button type="button" className="secondary" onClick={() => void onCheckResult()}>
                التحقق من النتيجة
              </button>
              {pendingSale.phase === "uncertain" ? (
                <button type="button" onClick={() => void submit(pendingSale.physicallyCompleted ? "complete" : "prepare")}>
                  إعادة المحاولة
                </button>
              ) : null}
            </>
          ) : foreignRecovery ? (
            <button type="button" className="secondary" onClick={() => void onCheckForeign()}>
              التحقق من النتيجة
            </button>
          ) : null}
          {pendingSale && foreignRecovery ? (
            <button type="button" className="secondary" onClick={() => void onCheckForeign()}>
              التحقق من العملية الأخرى
            </button>
          ) : null}
        </div>
      </form>

      {completed ? <SaleSummary sale={completed} /> : null}
    </main>
  );
}
