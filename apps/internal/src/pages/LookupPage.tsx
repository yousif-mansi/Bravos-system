import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CashierProductLookupDto, CashierVariantDto, PosPriceSnapshotDto, SaleDto, StockPauseDto, WorkspaceDto } from "@bravos/contracts";
import { SaleSummary } from "./SaleSummary.tsx";
import { ApiError, acceptOfflineSale, completeSale, getStockPause, getWorkspace, issuePosSnapshot, lookupProductByCode, lookupSaleOperation, prepareSale } from "../api.ts";
import { egpInputToPiasters, formatEgpFromPiasters } from "../money.ts";
import {
  acceptedPayload,
  applySyncedSale,
  cacheIssuedSnapshot,
  completedPayload,
  offlineFromQuote,
  pos,
  PosStorageError,
  saleFromOffline,
  syncOutcomeMessage,
} from "../pos.ts";
import { mergeVariantQuantities, SalesValidationError } from "@bravos/sales/browser";
import { accountGeneration, subscribeAccount } from "../account-session.ts";
import { getRestorePause } from "../restore-api.ts";
import { isNetworkFailure, signOutPreservingSales } from "../session.ts";
import {
  createPendingSale,
  digestSalePayload,
  withPendingSaleLock,
  type PendingSale,
  type SalePayload,
} from "../sales-pending.ts";

function saleWriteFromRecord(sale: SaleDto, occurredAt: string | null, restoreGeneration: number | null) {
  return {
    saleId: sale.id,
    operationId: sale.operationId,
    ...(restoreGeneration !== null ? { restoreGeneration } : {}),
    customerName: sale.customerName,
    customerPhone: sale.customerPhone,
    couponCode: sale.appliedCoupon?.code ?? null,
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

function cachedQuantitiesFromSnapshot(snapshot: PosPriceSnapshotDto): Map<string, number> {
  const cached = new Map<string, number>();
  for (const product of snapshot.products) {
    for (const variant of product.variants) {
      cached.set(variant.id, variant.availableQuantity);
    }
  }
  return cached;
}

function cachedQuantitiesFromCart(lines: CartLine[]): Map<string, number> {
  return new Map(lines.map((line) => [line.variant.id, line.variant.availableQuantity]));
}

function recordFromCached(cached: Map<string, number> | null): Record<string, number> | null {
  if (!cached) {
    return null;
  }
  return Object.fromEntries(cached.entries());
}

function cachedFromRecord(record: Record<string, number> | null | undefined): Map<string, number> | null {
  if (!record) {
    return null;
  }
  return new Map(Object.entries(record));
}

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
  const [couponCode, setCouponCode] = useState("");
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
  const foreignRecoverySnapshotRef = useRef<PosPriceSnapshotDto | null>(null);
  // Restore generation observed when a server quote was accepted; null when it could not be read.
  const quoteGenerationRef = useRef<number | null>(null);
  const cartRef = useRef<CartLine[]>([]);
  const revisionEpochRef = useRef(0);
  const submitEpochRef = useRef(0);
  const [revisionBlock, setRevisionBlock] = useState(false);
  const [foreignRecovery, setForeignRecovery] = useState<PendingSale | null>(null);
  const [effectiveByVariant, setEffectiveByVariant] = useState<Record<string, number>>({});
  const [stockPause, setStockPause] = useState<StockPauseDto | null>(null);
  const [restorePause, setRestorePause] = useState<PosPriceSnapshotDto["restorePause"]>(null);
  const quoteOriginRef = useRef<"server" | "snapshot" | null>(null);
  const quoteSnapshotRef = useRef<PosPriceSnapshotDto | null>(null);
  const quoteCachedRef = useRef<Map<string, number> | null>(null);
  cartRef.current = cart;

  useEffect(() => {
    return subscribeAccount((payload) => {
      if (payload.staffId !== workspace.staff.id) {
        setCart([]);
        setQuote(null);
        setCompleted(null);
        setPendingSale(null);
        pendingSaleRef.current = null;
        foreignRecoveryRef.current = null;
        foreignRecoverySnapshotRef.current = null;
        setHandedOver(false);
      }
    });
  }, [workspace.staff.id]);

  useEffect(() => {
    let cancelled = false;
    const epoch = accountGeneration();
    const refresh = async () => {
      if (cancelled || accountGeneration() !== epoch) return;
      if (stockPause && new Date(stockPause.expiresAt).getTime() <= Date.now()) setStockPause(null);
      if (!navigator.onLine) return;
      try {
        const current = await getStockPause();
        if (!cancelled && accountGeneration() === epoch) setStockPause(current);
      } catch {
        /* the transactional server guard remains authoritative while refresh is unavailable */
      }
    };
    const interval = window.setInterval(() => void refresh(), 5_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    void refresh();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [workspace.staff.id, stockPause?.coordinationId, stockPause?.expiresAt]);

  useEffect(() => {
    let cancelled = false;
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const stillCurrent = () => !cancelled && accountGeneration() === epoch && workspace.staff.id === staffId;
    const refresh = async () => {
      if (!stillCurrent()) return;
      if (!navigator.onLine) {
        const cached = await pos.loadSnapshot(staffId);
        if (stillCurrent()) setRestorePause(cached?.restorePause ?? null);
        return;
      }
      try {
        const state = await getRestorePause();
        if (stillCurrent()) setRestorePause(state.pause);
      } catch {
        /* keep the last observed restore pause until a later refresh */
      }
    };
    const interval = window.setInterval(() => void refresh(), 5_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    void refresh();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [workspace.staff.id]);

  useEffect(() => {
    setCart([]);
    setQuote(null);
    setCompleted(null);
    setError("");
    setNotice("");
    setHandedOver(false);
    pendingSaleRef.current = null;
    setPendingSale(null);
    foreignRecoveryRef.current = null;
    foreignRecoverySnapshotRef.current = null;
    setForeignRecovery(null);
    quoteOriginRef.current = null;
    quoteSnapshotRef.current = null;
    quoteCachedRef.current = null;
  }, [workspace.staff.id]);

  useEffect(() => {
    let cancelled = false;
    void pos.migrateLegacyMarkers().then(async () => {
      const recoverable = await pos.listRecoverablePending(workspace.staff.id);
      const stored = recoverable.find((row) => row.physicallyCompleted) ?? recoverable[0];
      const extras = recoverable.filter((row) => row.saleId !== stored?.saleId);
      if (cancelled || !stored) {
        return;
      }
      if (extras[0]) {
        const blocked: PendingSale = {
          saleId: extras[0].saleId,
          operationId: extras[0].operationId,
          staffId: extras[0].staffId,
          phase: extras[0].phase,
          digest: extras[0].digest,
          physicallyCompleted: extras[0].physicallyCompleted,
          payload: extras[0].payload,
          occurredAt: extras[0].occurredAt,
          pricingOccurredAt: extras[0].pricingOccurredAt ?? null,
        };
        foreignRecoveryRef.current = blocked;
        foreignRecoverySnapshotRef.current = extras[0].snapshot;
        setForeignRecovery(blocked);
      }
      const pending: PendingSale = {
        saleId: stored.saleId,
        operationId: stored.operationId,
        staffId: stored.staffId,
        phase: stored.phase,
        digest: stored.digest,
        physicallyCompleted: stored.physicallyCompleted,
        payload: stored.payload,
        occurredAt: stored.occurredAt,
        pricingOccurredAt: stored.pricingOccurredAt ?? null,
      };
      pendingSaleRef.current = pending;
      setPendingSale(pending);
      if (stored.payload) {
        frozenPayloadRef.current = stored.payload;
        setFrozenPayload(stored.payload);
        setCustomerName(stored.payload.customerName ?? "");
        setCustomerPhone(stored.payload.customerPhone ?? "");
        setCouponCode(stored.payload.couponCode ?? "");
        setDiscountEgp((stored.payload.employeeDiscountPiasters / 100).toString());
        setDiscountReason(stored.payload.discountReason ?? "");
      }
      if (stored.quote) {
        setQuote(stored.quote);
      }
      if (stored.snapshot) {
        quoteSnapshotRef.current = stored.snapshot;
      }
      if (stored.quoteOrigin) {
        quoteOriginRef.current = stored.quoteOrigin;
      }
      if (stored.cachedByVariant) {
        quoteCachedRef.current = cachedFromRecord(stored.cachedByVariant);
      } else if (stored.quote && stored.snapshot) {
        quoteCachedRef.current = cachedQuantitiesFromSnapshot(stored.snapshot);
      }
      inFlightRef.current = true;
      setPending("check");
      return lookupSaleOperation(stored.operationId)
        .then(async (found) => {
          if (cancelled) {
            return;
          }
          if (found?.physicallyCompleted) {
            const unsynced = (await pos.listUnsynced(workspace.staff.id)).find((row) => row.id === found.id);
            if (unsynced) {
              try {
                const synced =
                  unsynced.kind === "accepted" && unsynced.snapshotId
                    ? await acceptOfflineSale(await acceptedPayload(unsynced))
                    : await completeSale(await completedPayload(unsynced));
                await applySyncedSale(unsynced, synced);
              } catch {
                /* keep unacknowledged until retry */
              }
            }
            await acceptSale(found, "تم العثور على البيع المحفوظ.");
            return;
          }
          if (stored.physicallyCompleted) {
            setHandedOver(true);
            setError("تم تسليم البضاعة واستلام النقد. لا تطلب الدفع مرة أخرى. أعد المحاولة لحفظ البيع.");
            if (found && !found.physicallyCompleted) {
              setQuote(found);
              const recovered = await completeSale(saleWriteFromRecord(found, stored.occurredAt, stored.snapshot?.restoreGeneration ?? null));
              if (!cancelled && recovered.physicallyCompleted) {
                await acceptSale(recovered, "تم حفظ البيع النقدي.");
              }
            }
            return;
          }
          if (found && !found.physicallyCompleted) {
            setQuote(found);
            const prepared: PendingSale = {
              saleId: stored.saleId,
              operationId: stored.operationId,
              staffId: stored.staffId,
              phase: "prepared",
              digest: stored.digest,
              physicallyCompleted: stored.physicallyCompleted,
              payload: stored.payload,
              occurredAt: stored.occurredAt,
              pricingOccurredAt: stored.pricingOccurredAt ?? null,
            };
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
          if (!cancelled && !isNetworkFailure(caught)) {
            setError(caught instanceof ApiError ? caught.messageAr : "تعذر التحقق من البيع.");
          }
        })
        .finally(() => {
          if (!cancelled) {
            inFlightRef.current = false;
            setPending("");
          }
        });
    });
    return () => {
      cancelled = true;
      inFlightRef.current = false;
    };
  }, [workspace.staff.id]);

  useEffect(() => {
    let cancelled = false;
    const epoch = accountGeneration();
    const staffId = workspace.staff.id;
    void (async () => {
      if (!navigator.onLine) {
        return;
      }
      try {
        const deviceId = await pos.deviceId();
        if (cancelled || accountGeneration() !== epoch) {
          return;
        }
        const snapshot = await issuePosSnapshot(deviceId, await pos.listPendingOperationIds());
        if (cancelled || accountGeneration() !== epoch) {
          return;
        }
        await cacheIssuedSnapshot(staffId, snapshot);
        setStockPause(snapshot.stockPause);
      } catch {
        /* keep last issued snapshot */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace.staff.id]);

  async function logout() {
    const accepted = await signOutPreservingSales(workspace.staff.id);
    if (!accepted) {
      return;
    }
    await onChanged(null);
    navigate("/login");
  }

  async function withLocalAvailability(found: CashierProductLookupDto): Promise<CashierProductLookupDto> {
    const next: Record<string, number> = {};
    for (const variant of found.variants) {
      next[variant.id] = await pos.availableQuantity(variant.id, variant.availableQuantity);
    }
    setEffectiveByVariant(next);
    return found;
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    setError("");
    setPending("search");
    try {
      let found;
      try {
        found = await lookupProductByCode(code);
      } catch (caught) {
        if (!isNetworkFailure(caught)) {
          throw caught;
        }
        found = await pos.lookupProduct(workspace.staff.id, code);
        if (!found) {
          throw new ApiError(404, "NOT_FOUND", "المنتج غير موجود.");
        }
      }
      setProduct(await withLocalAvailability(found));
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
  const selectedEffective =
    selected ? (effectiveByVariant[selected.id] ?? selected.availableQuantity) : 0;

  function addSelected() {
    if (!product || !selected) {
      return;
    }
    if (!beginCartRevision()) {
      return;
    }
    setCart((current) => [...current, { key: crypto.randomUUID(), product, variant: selected, quantity: 1 }]);
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
      couponCode: couponCode.trim().toLocaleUpperCase("en-US") || null,
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
    quoteOriginRef.current = null;
    quoteSnapshotRef.current = null;
    quoteCachedRef.current = null;
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
    await withPendingSaleLock(workspace.staff.id, () => pos.clearPending(workspace.staff.id, targetId));
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
    await withPendingSaleLock(workspace.staff.id, () => pos.clearPending(workspace.staff.id, sale.id));
    const recoveringForeign = Boolean(foreignRecoveryRef.current && foreignRecoveryRef.current.saleId === sale.id);
    const recoveringLocal = Boolean(pendingSaleRef.current && pendingSaleRef.current.saleId === sale.id);
    if (recoveringForeign) {
      foreignRecoveryRef.current = null;
      foreignRecoverySnapshotRef.current = null;
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
      setCouponCode("");
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
    quoteOriginRef.current = null;
    quoteSnapshotRef.current = null;
    quoteCachedRef.current = null;
    if (product) {
      void withLocalAvailability(product).then((next) => {
        setProduct(next);
      });
    }
  }

  async function assertLocalCartStock(lines: CartLine[]) {
    const merged = mergeVariantQuantities(lines.map((line) => ({ variantId: line.variant.id, quantity: line.quantity })));
    for (const item of merged) {
      const source = lines.find((line) => line.variant.id === item.variantId);
      const cached = source?.variant.availableQuantity ?? 0;
      const available = await pos.availableQuantity(item.variantId, cached);
      if (available < item.quantity) {
        throw new SalesValidationError("الكمية المتاحة غير كافية.");
      }
    }
  }

  async function quoteFromSnapshot(pending: PendingSale, payload: SalePayload): Promise<SaleDto> {
    const snapshot = quoteSnapshotRef.current ?? (await pos.loadSnapshot(workspace.staff.id));
    if (!snapshot || !workspace.activeBranch) {
      throw new ApiError(503, "VALIDATION", "لم تكتمل جاهزية نقطة البيع دون اتصال بعد.");
    }
    await assertLocalCartStock(cart);
    quoteSnapshotRef.current = snapshot;
    quoteCachedRef.current = cachedQuantitiesFromSnapshot(snapshot);
    const pricingOccurredAt = pending.pricingOccurredAt ?? new Date().toISOString();
    const priced = await pos.priceCart({
      staffId: workspace.staff.id,
      saleId: pending.saleId,
      operationId: pending.operationId,
      deviceId: await pos.deviceId(),
      snapshot,
      kind: "accepted",
      branch: snapshot.branch,
      soldByDisplayName: workspace.staff.displayName,
      occurredAt: pending.occurredAt ?? pricingOccurredAt,
      pricingOccurredAt,
      customerName: payload.customerName,
      customerPhone: payload.customerPhone,
      couponCode: payload.couponCode ?? null,
      employeeDiscountPiasters: payload.employeeDiscountPiasters,
      discountReason: payload.discountReason,
      lines: cart.map((line) => ({
        variantId: line.variant.id,
        quantity: line.quantity,
        product: line.product,
        variant: line.variant,
      })),
    });
    quoteOriginRef.current = "snapshot";
    return {
      id: pending.saleId,
      operationId: pending.operationId,
      branch: snapshot.branch,
      soldByStaffId: workspace.staff.id,
      soldByDisplayName: workspace.staff.displayName,
      occurredAt: pricingOccurredAt,
      recordedAt: null,
      customerName: payload.customerName,
      customerPhone: payload.customerPhone,
      originalTotalPiasters: priced.originalTotalPiasters,
      automaticOfferDiscountPiasters: priced.automaticOfferDiscountPiasters,
      appliedAutomaticOffer: priced.appliedAutomaticOffer,
      couponDiscountPiasters: priced.couponDiscountPiasters,
      appliedCoupon: priced.appliedCoupon,
      employeeDiscountPiasters: payload.employeeDiscountPiasters,
      discountReason: payload.discountReason,
      discountedByStaffId: payload.employeeDiscountPiasters > 0 ? workspace.staff.id : null,
      finalTotalPiasters: priced.finalTotalPiasters,
      exchangeCreditAppliedPiasters: 0,
      cashReceivedPiasters: priced.finalTotalPiasters,
      physicallyCompleted: false,
      discrepancy: null,
      lines: priced.lines.map((line) => {
        const source = cart.find((item) => item.variant.id === line.variantId);
        if (!source) {
          throw new ApiError(400, "VALIDATION", "المتغير المحدد غير موجود.");
        }
        return {
          id: crypto.randomUUID(),
          variantId: line.variantId,
          quantity: line.quantity,
          listedUnitPricePiasters: line.listedUnitPricePiasters,
          originalPiasters: line.originalPiasters,
          discountPiasters: line.discountPiasters,
          paidPiasters: line.paidPiasters,
          automaticOfferDiscountPiasters: line.automaticOfferDiscountPiasters,
          couponDiscountPiasters: line.couponDiscountPiasters,
          employeeDiscountPiasters: line.employeeDiscountPiasters,
          allocatedQuantity: 0,
          unallocatedQuantity: 0,
          units: line.units,
          variant: {
            id: source.variant.id,
            product: { id: source.product.id, code: source.product.code, nameAr: source.product.nameAr },
            size: source.variant.size,
            color: source.variant.color,
          },
        };
      }),
    };
  }

  async function persistPhysicalSale(pending: PendingSale, payload: SalePayload): Promise<SaleDto> {
    const occurredAt = pending.occurredAt ?? new Date().toISOString();
    const pinnedQuote = quote;
    const pinnedSnapshot = quoteSnapshotRef.current;
    const origin = quoteOriginRef.current;
    if (pinnedQuote && origin === "server") {
      const restoreGeneration = quoteGenerationRef.current ?? pinnedSnapshot?.restoreGeneration ?? null;
      const recorded = await pos.recordCompleted(
        offlineFromQuote({
          staffId: workspace.staff.id,
          deviceId: await pos.deviceId(),
          quote: pinnedQuote,
          occurredAt,
          kind: "connected",
          snapshotId: null,
          ...(restoreGeneration !== null ? { restoreGeneration } : {}),
        }),
        quoteCachedRef.current ?? cachedQuantitiesFromCart(cart),
      );
      return saleFromOffline(recorded);
    }
    if (pinnedQuote && origin === "snapshot" && pinnedSnapshot) {
      const recorded = await pos.recordCompleted(
        offlineFromQuote({
          staffId: workspace.staff.id,
          deviceId: pinnedSnapshot.deviceId,
          quote: pinnedQuote,
          occurredAt,
          kind: "accepted",
          snapshotId: pinnedSnapshot.snapshotId,
          pricingVersion: pinnedSnapshot.pricingVersion === 1 ? 1 : null,
          restoreGeneration: pinnedSnapshot.restoreGeneration,
          pricingOccurredAt: pending.pricingOccurredAt ?? pinnedQuote.occurredAt,
        }),
        quoteCachedRef.current ?? cachedQuantitiesFromSnapshot(pinnedSnapshot),
      );
      return saleFromOffline(recorded);
    }
    throw new PosStorageError("لم تكتمل جاهزية نقطة البيع دون اتصال بعد.");
  }

  async function syncPersistedSale(saleId: string) {
    const rows = await pos.listUnsynced(workspace.staff.id);
    const local = rows.find((row) => row.id === saleId);
    if (!local) {
      return;
    }
    try {
      const synced =
        local.kind === "accepted" && local.snapshotId
          ? await acceptOfflineSale(await acceptedPayload(local))
          : await completeSale(await completedPayload(local));
      await applySyncedSale(local, synced);
    } catch (caught) {
      setError(`${syncOutcomeMessage(caught)} البيع المكتمل محفوظ محلياً وسيظل ضمن المبيعات غير المرسلة.`);
    }
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
    const generation = accountGeneration();
    const physical = kind === "complete";
    const alreadyCompleted = handedOver || pendingSaleRef.current?.physicallyCompleted === true;
    if ((stockPause || restorePause) && (kind === "prepare" || !alreadyCompleted)) {
      inFlightRef.current = false;
      setPending("");
      setError(restorePause
        ? "العمل متوقف مؤقتاً لمراجعة استعادة البيانات. لا تبدأ بيعاً جديداً ولا تسلّم بضاعة حتى انتهاء التوقف."
        : "تغييرات المخزون متوقفة مؤقتاً. لا تبدأ بيعاً جديداً ولا تسلّم بضاعة حتى انتهاء التوقف.");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine && !pendingSaleRef.current?.physicallyCompleted) {
      try {
        const fresh = await getWorkspace();
        if (accountGeneration() !== generation || revisionEpochRef.current !== epoch) {
          inFlightRef.current = false;
          setPending("");
          return;
        }
        const pinnedBranchId = quoteSnapshotRef.current?.branch.id ?? workspace.activeBranch?.id;
        if (
          fresh.staff.id !== workspace.staff.id ||
          !fresh.capabilities.cashier ||
          !fresh.activeBranch ||
          !pinnedBranchId ||
          fresh.activeBranch.id !== pinnedBranchId
        ) {
          inFlightRef.current = false;
          setPending("");
          setError("لا يمكن بدء عمل متصل جديد بهذا الحساب. المبيعات المكتملة محفوظة ويمكن استردادها بمساعدة المدير.");
          await onChanged(fresh.staff.id === workspace.staff.id ? fresh : null);
          return;
        }
      } catch (caught) {
        if (accountGeneration() !== generation || revisionEpochRef.current !== epoch) {
          inFlightRef.current = false;
          setPending("");
          return;
        }
        if (caught instanceof ApiError && caught.status === 401) {
          inFlightRef.current = false;
          setPending("");
          setError("انتهت الجلسة أو أُلغي الدخول. سجّل الدخول مجدداً. المبيعات المكتملة محفوظة.");
          await onChanged(null);
          return;
        }
        if (caught instanceof ApiError && caught.status === 403) {
          inFlightRef.current = false;
          setPending("");
          setError("لا يمكن بدء عمل متصل جديد بهذا الحساب. المبيعات المكتملة محفوظة ويمكن استردادها بمساعدة المدير.");
          return;
        }
      }
    }
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
    if (kind === "prepare" && navigator.onLine) {
      // A server quote remembers the restore generation it was accepted under, without issuing a POS snapshot.
      quoteGenerationRef.current = null;
      try {
        const state = await getRestorePause();
        setRestorePause(state.pause);
        if (state.pause) {
          inFlightRef.current = false;
          setPending("");
          setError("العمل متوقف مؤقتاً لمراجعة استعادة البيانات. لا تبدأ بيعاً جديداً.");
          return;
        }
        quoteGenerationRef.current = state.currentGeneration;
      } catch {
        /* the server records the current generation when the sale is completed */
      }
    }
    try {
      const pendingRecord = {
        staffId: workspace.staff.id,
        saleId: local.saleId,
        operationId: local.operationId,
        phase: "uncertain" as const,
        digest,
        physicallyCompleted: physical || local.physicallyCompleted,
        payload,
        occurredAt: local.occurredAt,
        pricingOccurredAt: local.pricingOccurredAt ?? null,
        quote,
        snapshot: quoteSnapshotRef.current,
        quoteOrigin: quoteOriginRef.current,
        cachedByVariant: recordFromCached(quoteCachedRef.current),
      };
      const assignment = await withPendingSaleLock(workspace.staff.id, () => pos.savePending(pendingRecord));
      if (assignment === "blocked") {
        const stored = await pos.loadPending(workspace.staff.id);
        setError(
          stored?.physicallyCompleted
            ? "تم تسليم البضاعة واستلام النقد. لا تطلب الدفع مرة أخرى. تحقق من النتيجة أو أعد المحاولة بنفس البيانات."
            : "توجد عملية بيع غير مؤكدة. تحقق من نتيجتها قبل بدء بيع جديد.",
        );
        submittedRef.current = local;
        localIdentityRef.current = { saleId: local.saleId, operationId: local.operationId };
        if (stored) {
          const blocked: PendingSale = {
            saleId: stored.saleId,
            operationId: stored.operationId,
            staffId: stored.staffId,
            phase: stored.phase,
            digest: stored.digest,
            physicallyCompleted: stored.physicallyCompleted,
            payload: stored.payload,
            occurredAt: stored.occurredAt,
            pricingOccurredAt: stored.pricingOccurredAt ?? null,
          };
          foreignRecoveryRef.current = blocked;
          foreignRecoverySnapshotRef.current = stored.snapshot;
          setForeignRecovery(blocked);
        }
        if (local.physicallyCompleted) {
          pendingSaleRef.current = local;
          setPendingSale(local);
        } else {
          pendingSaleRef.current = null;
        }
        return;
      }
      const nextPending: PendingSale = {
        ...local,
        digest,
        phase: "uncertain",
        physicallyCompleted: physical || local.physicallyCompleted,
        payload,
      };
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
      if (kind === "complete") {
        const saved = await persistPhysicalSale(nextPending, payload);
        await acceptSale(saved, "تم حفظ البيع النقدي.");
        void syncPersistedSale(saved.id);
        return;
      }
      await assertLocalCartStock(cart);
      let result: SaleDto;
      try {
        result = await prepareSale(body);
        quoteOriginRef.current = "server";
        quoteCachedRef.current = cachedQuantitiesFromCart(cart);
      } catch (caught) {
        if (!isNetworkFailure(caught)) {
          throw caught;
        }
        result = await quoteFromSnapshot(nextPending, payload);
      }
      if (revisionEpochRef.current !== epoch) {
        setError("أكد الأسعار بعد تعديل السلة قبل إتمام البيع.");
        revisionBlockRef.current = true;
        setRevisionBlock(true);
        setQuote(null);
        return;
      }
      if (result.physicallyCompleted) {
        await acceptSale(result, "تم العثور على البيع المحفوظ.");
        return;
      }
      const prepared: PendingSale = {
        ...nextPending,
        phase: "prepared",
        payload,
        pricingOccurredAt: quoteOriginRef.current === "snapshot" ? result.occurredAt : null,
      };
      pendingSaleRef.current = prepared;
      await withPendingSaleLock(workspace.staff.id, () =>
        pos.savePending({
          staffId: workspace.staff.id,
          saleId: prepared.saleId,
          operationId: prepared.operationId,
          phase: "prepared",
          digest,
          physicallyCompleted: false,
          payload,
          occurredAt: prepared.occurredAt,
          pricingOccurredAt: prepared.pricingOccurredAt ?? null,
          quote: result,
          snapshot: quoteSnapshotRef.current,
          quoteOrigin: quoteOriginRef.current,
          cachedByVariant: recordFromCached(quoteCachedRef.current),
        }),
      );
      setPendingSale(prepared);
      setQuote(result);
      revisionBlockRef.current = false;
      setRevisionBlock(false);
      setNotice("تم قبول الأسعار من الخادم. يمكنك تعديل السلة أو تأكيد التسليم والدفع.");
    } catch (caught) {
      const current = submittedRef.current ?? pendingSaleRef.current;
      if (caught instanceof PosStorageError) {
        if (current) {
          const uncertain: PendingSale = {
            ...current,
            phase: "uncertain",
            physicallyCompleted: physical || current.physicallyCompleted,
            payload,
          };
          pendingSaleRef.current = uncertain;
          setPendingSale(uncertain);
        }
        setError("تعذر حفظ البيع محلياً. لا تطلب الدفع مرة أخرى. أعد المحاولة للحفظ.");
        return;
      }
      if (caught instanceof SalesValidationError) {
        if (current && (physical || current.physicallyCompleted)) {
          const uncertain: PendingSale = {
            ...current,
            phase: "uncertain",
            physicallyCompleted: true,
            payload,
          };
          pendingSaleRef.current = uncertain;
          setPendingSale(uncertain);
        }
        setError(caught.message);
        return;
      }
      if (caught instanceof ApiError && caught.status === 409) {
        const found = await lookupSaleOperation(current?.operationId ?? "");
        if (found?.physicallyCompleted) {
          await acceptSale(found, "تم العثور على البيع المحفوظ.");
          return;
        }
      }
      if (caught instanceof ApiError && (caught.status === 400 || caught.status === 404) && current && !current.physicallyCompleted) {
        const rejected: PendingSale = { ...current, phase: "rejected", digest: null };
        await withPendingSaleLock(workspace.staff.id, () =>
          pos.savePending({
            staffId: workspace.staff.id,
            saleId: rejected.saleId,
            operationId: rejected.operationId,
            phase: "rejected",
            digest: null,
            physicallyCompleted: false,
            payload: rejected.payload,
            occurredAt: rejected.occurredAt,
            pricingOccurredAt: rejected.pricingOccurredAt ?? null,
            quote: null,
            snapshot: null,
            quoteOrigin: null,
            cachedByVariant: null,
          }),
        );
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
        await withPendingSaleLock(workspace.staff.id, () =>
          pos.savePending({
            staffId: workspace.staff.id,
            saleId: uncertain.saleId,
            operationId: uncertain.operationId,
            phase: "uncertain",
            digest,
            physicallyCompleted: uncertain.physicallyCompleted,
            payload,
            occurredAt: uncertain.occurredAt,
            pricingOccurredAt: uncertain.pricingOccurredAt ?? null,
            quote,
            snapshot: quoteSnapshotRef.current,
            quoteOrigin: quoteOriginRef.current,
            cachedByVariant: recordFromCached(quoteCachedRef.current),
          }),
        );
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
        const recovered = await completeSale(saleWriteFromRecord(
          found,
          current.occurredAt,
          adoptQuote
            ? quoteGenerationRef.current ?? quoteSnapshotRef.current?.restoreGeneration ?? null
            : foreignRecoverySnapshotRef.current?.restoreGeneration ?? null,
        ));
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
      {stockPause ? (
        <div className="error" data-testid="stock-pause" role="alert">
          تغييرات المخزون متوقفة مؤقتاً لإجراء تصحيح كمية. لا تبدأ بيعاً جديداً ولا تسلّم بضاعة.
        </div>
      ) : null}
      {restorePause ? (
        <div className="error" data-testid="restore-pause" role="alert">
          العمل متوقف مؤقتاً لمراجعة استعادة نسخة البيانات. لا تبدأ بيعاً جديداً ولا تسلّم بضاعة.
        </div>
      ) : null}
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
              <p data-testid="available-quantity">الكمية المتاحة: {selectedEffective}</p>
              {selectedEffective === 0 ? (
                <p className="muted">غير متوفر في المخزون حتى يتم الاستلام.</p>
              ) : (
                <button type="button" disabled={formLocked || Boolean(stockPause) || Boolean(restorePause)} onClick={addSelected}>إضافة إلى السلة</button>
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
          <label htmlFor="couponCode">كود الكوبون</label>
          <input id="couponCode" value={couponCode} disabled={formLocked} onChange={(event) => { if (beginCartRevision()) setCouponCode(event.target.value); }} />
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
            {quote.appliedAutomaticOffer ? (
              <p data-testid="automatic-offer-breakdown">
                العرض التلقائي: {quote.appliedAutomaticOffer.nameAr} — {formatEgpFromPiasters(quote.automaticOfferDiscountPiasters)}
              </p>
            ) : <p className="muted">لا يوجد عرض تلقائي مطبق.</p>}
            {quote.appliedCoupon ? (
              <p data-testid="coupon-breakdown">الكوبون: {quote.appliedCoupon.code} — {formatEgpFromPiasters(quote.couponDiscountPiasters)}</p>
            ) : null}
            <p>خصم الموظف: {formatEgpFromPiasters(quote.employeeDiscountPiasters)}</p>
            <p>الإجمالي: {formatEgpFromPiasters(quote.finalTotalPiasters)}</p>
          </section>
        ) : null}
        <div className="field">
          <label htmlFor="handedOver">
            <input
              id="handedOver"
              type="checkbox"
              checked={handedOver || pendingSale?.physicallyCompleted === true}
              disabled={Boolean(stockPause) || Boolean(restorePause) || (!quote && !pendingSale?.physicallyCompleted)}
              onChange={(event) => setHandedOver(event.target.checked)}
            />
            {" "}استلم الزبون البضاعة ودفع نقداً
          </label>
        </div>
        <div className="actions">
          <button type="button" disabled={Boolean(stockPause) || Boolean(restorePause) || Boolean(pending) || cart.length === 0 || formLocked} onClick={() => void submit("prepare")}>
            {pending === "prepare" ? "جارٍ قبول الأسعار…" : "قبول الأسعار"}
          </button>
          {quote && !formLocked ? (
            <button type="button" className="secondary" onClick={() => beginCartRevision()}>
              إلغاء عرض السعر
            </button>
          ) : null}
          <button type="button" disabled={((Boolean(stockPause) || Boolean(restorePause)) && !handedOver && !pendingSale?.physicallyCompleted) || Boolean(pending) || revisionBlock || (!quote && !pendingSale?.physicallyCompleted)} onClick={() => void submit("complete")}>
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
