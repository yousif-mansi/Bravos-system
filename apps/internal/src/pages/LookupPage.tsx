import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { CashierProductLookupDto, CashierVariantDto, PosPriceSnapshotDto, SaleDto, SalePaymentDto, StockPauseDto, WorkspaceDto } from "@bravos/contracts";
import { printCompletedBranchReceipt, receiptPrintFailureMessage, receiptPrintStatus, SaleSummary } from "./SaleSummary.tsx";
import { ApiError, acceptOfflineSale, completeSale, getStockPause, getWorkspace, lookupCustomer, lookupProductByCode, lookupSaleOperation, prepareSale } from "../api.ts";
import { egpInputToPiasters, formatEgpFromPiasters } from "../money.ts";
import {
  acceptedPayload,
  applySyncedSale,
  cacheIssuedSnapshot,
  completedPayload,
  issueStaffPosSnapshot,
  offlineFromQuote,
  notifyPosStockChange,
  pos,
  PosStorageError,
  saleFromOffline,
  syncOutcomeMessage,
  subscribePosStockChanges,
} from "../pos.ts";
import { mergeVariantQuantities, SalesValidationError } from "@bravos/sales/browser";
import { accountGeneration, subscribeAccount } from "../account-session.ts";
import { preservedSummaryReceipt } from "../receipt-number.ts";
import { getRestorePause } from "../restore-api.ts";
import { isNetworkFailure } from "../session.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { ProductBrowser } from "./pos/ProductBrowser.tsx";
import {
  findCachedProductByCode,
  isolateScanSubmit,
  useProductCodeScanner,
} from "./pos/useProductCodeScanner.ts";
import { ProductLabelAction } from "../labels/ProductLabelAction.tsx";
import { releaseReceiptPrintResources } from "../receipts/index.ts";
import "./pos/pos-workspace.css";
import {
  createPendingSale,
  digestSalePayload,
  withPendingSaleLock,
  type PendingSale,
  type SalePayload,
} from "../sales-pending.ts";

function saleWriteFromRecord(sale: SaleDto, occurredAt: string | null, restoreGeneration: number | null, payment?: SalePaymentDto) {
  return {
    saleId: sale.id,
    operationId: sale.operationId,
    ...(restoreGeneration !== null ? { restoreGeneration } : {}),
    customerName: sale.customerName,
    customerPhone: sale.customerPhone,
    couponCode: sale.appliedCoupon?.code ?? null,
    employeeDiscountPiasters: sale.employeeDiscountPiasters,
    discountReason: sale.discountReason,
    payment: payment ?? sale.payment,
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

function sellableVariant(product: CashierProductLookupDto): CashierVariantDto | null {
  if (!product.operationalVariantId) return null;
  return {
    id: product.operationalVariantId,
    size: { id: "", nameAr: "" },
    color: { id: "", nameAr: "" },
    sellingPricePiasters: product.sellingPricePiasters,
    availableQuantity: product.availableQuantity,
  };
}

function cachedQuantitiesFromSnapshot(snapshot: PosPriceSnapshotDto): Map<string, number> {
  const cached = new Map<string, number>();
  for (const product of snapshot.products) {
    cached.set(product.operationalVariantId, product.availableQuantity);
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
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState("");
  const [product, setProduct] = useState<CashierProductLookupDto | null>(null);
  const [browseProducts, setBrowseProducts] = useState<CashierProductLookupDto[]>([]);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [browseMessage, setBrowseMessage] = useState("");
  const [savedCustomer, setSavedCustomer] = useState<{ displayName: string; normalizedPhone: string } | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [discountEgp, setDiscountEgp] = useState("0");
  const [discountReason, setDiscountReason] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<SalePaymentDto["method"]>("cash");
  const [cashEgp, setCashEgp] = useState("");
  const [onlineEgp, setOnlineEgp] = useState("");
  const [quote, setQuote] = useState<SaleDto | null>(null);
  const [completed, setCompleted] = useState<SaleDto | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [receiptStatus, setReceiptStatus] = useState("");
  const [searchError, setSearchError] = useState("");
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
  const browseRequestRef = useRef(0);
  const browseMountedRef = useRef(false);
  const browseNetworkRef = useRef(0);
  const browsePendingLocalRef = useRef(false);
  const browseAuthorizationBlockedRef = useRef(false);
  const browseFingerprintRef = useRef("");
  const contextKey = `${workspace.staff.id}:${workspace.activeBranch?.id ?? ""}`;
  const contextRef = useRef(contextKey);

  const { scanInputRef, onScanKeyDown, focusScanInput } = useProductCodeScanner();
  const [sizeFocusNonce, setSizeFocusNonce] = useState(0);
  contextRef.current = contextKey;
  cartRef.current = cart;

  const refreshBrowse = useCallback(async (connected = false): Promise<void> => {
    if (browseNetworkRef.current) {
      if (!connected) browsePendingLocalRef.current = true;
      return;
    }
    if ((!connected || !navigator.onLine) && browseAuthorizationBlockedRef.current) return;
    const staffId = workspace.staff.id;
    const branchId = workspace.activeBranch?.id;
    const capturedContext = `${staffId}:${branchId ?? ""}`;
    const epoch = accountGeneration();
    const request = ++browseRequestRef.current;
    const stillCurrent = () => browseMountedRef.current && contextRef.current === capturedContext &&
      accountGeneration() === epoch && browseRequestRef.current === request;
    if (!branchId || !stillCurrent()) return;
    browseNetworkRef.current = connected && navigator.onLine ? request : 0;
    try {
      if (connected && navigator.onLine) {
        if (!stillCurrent()) return;
        const snapshot = await issueStaffPosSnapshot(await pos.listPendingOperationIds(), "register");
        if (!stillCurrent() || snapshot.staffId !== staffId || snapshot.branch.id !== branchId) return;
        browseAuthorizationBlockedRef.current = false;
        await cacheIssuedSnapshot(staffId, snapshot);
        if (!stillCurrent()) return;
        setStockPause(snapshot.stockPause);
        setBrowseMessage("");
      }
      const snapshot = await pos.loadSnapshot(staffId);
      if (!stillCurrent()) return;
      if (!snapshot || snapshot.staffId !== staffId || snapshot.branch.id !== branchId) {
        setBrowseProducts([]);
        setBrowseMessage("قائمة الأصناف غير جاهزة. يمكنك البحث برمز المنتج عند الاتصال.");
        return;
      }
      // A saved sale adds an operation; acknowledgements update the overlaid snapshot.
      // Unchanged local reads avoid one stock-cache read and effects query per variant.
      const pendingIds = await pos.listPendingOperationIds();
      if (!stillCurrent()) return;
      const fingerprint = JSON.stringify([snapshot.snapshotId, snapshot.stockVersion, snapshot.products,
        snapshot.includedOperationIds, pendingIds.sort()]);
      if (browseFingerprintRef.current === fingerprint) return;
      const quantities: Record<string, number> = {};
      await Promise.all(snapshot.products.flatMap((item) => [
        (async () => {
          quantities[item.operationalVariantId] = await pos.availableQuantity(
            branchId,
            item.operationalVariantId,
            item.availableQuantity,
          );
        })(),
        ...item.variants.map(async (variant) => {
          quantities[variant.id] = await pos.availableQuantity(branchId, variant.id, variant.availableQuantity);
        }),
      ]));
      if (!stillCurrent()) return;
      browseFingerprintRef.current = fingerprint;
      setBrowseProducts(snapshot.products);
      setEffectiveByVariant(quantities);
      setProduct((current) => snapshot.products.find((item) => item.id === current?.id) ?? current);
    } catch (caught) {
      if (!stillCurrent()) return;
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
        browseAuthorizationBlockedRef.current = true;
        browseFingerprintRef.current = "";
        setBrowseProducts([]);
        setProduct(null);
        setEffectiveByVariant({});
        setBrowseMessage(caught.messageAr);
      } else if (connected) {
        // Keep the last staff-scoped list; the next local read can use its stock overlays.
        setBrowseMessage("تعذر تحديث القائمة. الأسعار والكميات المعروضة حسب آخر تحديث محفوظ.");
      }
    } finally {
      const current = stillCurrent();
      if (current) setBrowseLoading(false);
      if (browseNetworkRef.current === request) {
        browseNetworkRef.current = 0;
        if (current && browsePendingLocalRef.current) {
          browsePendingLocalRef.current = false;
          void refreshBrowse();
        }
      }
    }
  }, [workspace.staff.id, workspace.activeBranch?.id]);

  useEffect(() => {
    browseMountedRef.current = true;
    browseNetworkRef.current = 0;
    browsePendingLocalRef.current = false;
    browseAuthorizationBlockedRef.current = false;
    browseFingerprintRef.current = "";
    setBrowseMessage("");
    setBrowseProducts([]);
    setProduct(null);
    setEffectiveByVariant({});
    setBrowseLoading(true);
    const refreshConnected = () => void refreshBrowse(true);
    void refreshBrowse().then(() => refreshBrowse(true));
    const unsubscribeStock = subscribePosStockChanges((change) => {
      if (change.staffId === workspace.staff.id && change.branchId === workspace.activeBranch?.id) void refreshBrowse();
    });
    window.addEventListener("focus", refreshConnected);
    window.addEventListener("online", refreshConnected);
    return () => {
      browseMountedRef.current = false;
      browsePendingLocalRef.current = false;
      ++browseRequestRef.current;
      unsubscribeStock();
      window.removeEventListener("focus", refreshConnected);
      window.removeEventListener("online", refreshConnected);
    };
  }, [refreshBrowse]);

  useEffect(() => {
    if (sizeFocusNonce === 0) return;
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("[data-testid='add-operational']")?.focus({ preventScroll: true });
    });
  }, [sizeFocusNonce]);

  useEffect(() => {
    return subscribeAccount((payload) => {
      releaseReceiptPrintResources();
      if (payload.staffId !== workspace.staff.id) {
        browseAuthorizationBlockedRef.current = true;
        setBrowseProducts([]);
        setProduct(null);
        setEffectiveByVariant({});
        setCart([]);
        setQuote(null);
        setCompleted(null);
        setReceiptError("");
        setReceiptStatus("");
        setPendingSale(null);
        pendingSaleRef.current = null;
        foreignRecoveryRef.current = null;
        foreignRecoverySnapshotRef.current = null;
      }
    });
  }, [workspace.staff.id]);

  useEffect(() => {
    return () => {
      releaseReceiptPrintResources();
    };
  }, [contextKey]);

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
    setSearchError("");
    setNotice("");
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
      // An unfinished price quote may still belong to another open tab. Only a
      // physically completed sale needs automatic recovery across tabs/reloads.
      const completed = recoverable.filter((row) => row.physicallyCompleted);
      const stored = completed[0];
      const extras = completed.filter((row) => row.saleId !== stored?.saleId);
      if (cancelled || !stored || cartRef.current.length > 0 || pendingSaleRef.current || localIdentityRef.current) {
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
        if (stored.payload.payment) {
          setPaymentMethod(stored.payload.payment.method);
          setCashEgp((stored.payload.payment.cashPiasters / 100).toString());
          setOnlineEgp((stored.payload.payment.onlinePiasters / 100).toString());
        }
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
            setError("تم تسليم البضاعة واستلام المبلغ. لا تطلب الدفع مرة أخرى. أعد المحاولة لحفظ البيع.");
            if (found && !found.physicallyCompleted) {
              setQuote(found);
              const recovered = await completeSale(saleWriteFromRecord(found, stored.occurredAt, stored.snapshot?.restoreGeneration ?? null, stored.payload?.payment));
              if (!cancelled && recovered.physicallyCompleted) {
                await acceptSale(recovered, "تم حفظ البيع.");
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
            setNotice("تم استعادة الأسعار المقبولة.");
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

  async function withLocalAvailability(found: CashierProductLookupDto): Promise<CashierProductLookupDto> {
    if (!workspace.activeBranch) throw new SalesValidationError("اختر فرع البيع أولاً.");
    const capturedContext = contextKey;
    const epoch = accountGeneration();
    const next: Record<string, number> = {};
    const variant = sellableVariant(found);
    if (variant) {
      next[variant.id] = await pos.availableQuantity(workspace.activeBranch.id, variant.id, found.availableQuantity);
    }
    if (browseMountedRef.current && contextRef.current === capturedContext && accountGeneration() === epoch) {
      setEffectiveByVariant((current) => ({ ...current, ...next }));
    }
    return found;
  }

  async function onSearch(event: FormEvent) {
    isolateScanSubmit(event);
    const capturedContext = contextKey;
    const epoch = accountGeneration();
    const stillCurrent = () => browseMountedRef.current && contextRef.current === capturedContext && accountGeneration() === epoch;
    setError("");
    setSearchError("");
    setPending("search");
    try {
      let found;
      try {
        found = await lookupProductByCode(code);
      } catch (caught) {
        if (!isNetworkFailure(caught)) {
          throw caught;
        }
        const snapshot = await pos.loadSnapshot(workspace.staff.id);
        found = snapshot?.staffId === workspace.staff.id && snapshot.branch.id === workspace.activeBranch?.id
          ? findCachedProductByCode(snapshot.products, code) ?? null
          : null;
        if (!found) {
          throw new ApiError(404, "NOT_FOUND", "المنتج غير موجود.");
        }
      }
      await withLocalAvailability(found);
      if (!stillCurrent()) return;
      setProduct(found);
      setCode("");
      setSizeFocusNonce((nonce) => nonce + 1);
    } catch (caught) {
      if (!stillCurrent()) return;
      setProduct(null);
      setSearchError(caught instanceof ApiError ? caught.messageAr : "تعذر البحث عن المنتج.");
      focusScanInput();
    } finally {
      if (stillCurrent()) setPending("");
    }
  }

  const selected = product ? sellableVariant(product) : null;
  const selectedEffective = selected ? Math.max(0, effectiveByVariant[selected.id] ?? product?.availableQuantity ?? 0) : 0;
  const selectedCartQuantity = product ? cart.filter((line) => line.product.id === product.id).reduce((sum, line) => sum + line.quantity, 0) : 0;

  function addSelected() {
    if (!product || !selected) {
      if (product) setError("حدّث قائمة المنتجات قبل البيع.");
      return;
    }
    if (selectedCartQuantity >= selectedEffective) return;
    if (!beginCartRevision()) return;
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) => line.key === existing.key ? { ...line, quantity: line.quantity + 1 } : line);
      }
      return [...current, { key: crypto.randomUUID(), product, variant: selected, quantity: 1 }];
    });
    focusScanInput();
  }

  async function findSavedCustomer() {
    setError("");
    if (!customerPhone.trim()) {
      setError("أدخل الهاتف للبحث عن زبون محفوظ.");
      return;
    }
    setPending("customer");
    try {
      const result = await lookupCustomer({ phone: customerPhone, ...(customerName.trim() ? { name: customerName } : {}) });
      setSavedCustomer(result.customer);
      setNotice(result.customer ? `زبون محفوظ: ${result.customer.displayName}` : "لا يوجد زبون محفوظ بهذا الهاتف. البيع المجهول ما زال متاحاً.");
    } catch (caught) {
      setSavedCustomer(null);
      setError(caught instanceof ApiError ? caught.messageAr : "تعذر البحث عن الزبون.");
    } finally {
      setPending("");
    }
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
    let payment: SalePaymentDto | undefined;
    if (quote) {
      const total = quote.finalTotalPiasters;
      if (paymentMethod === "cash") payment = { method: "cash", cashPiasters: total, onlinePiasters: 0 };
      else if (paymentMethod === "online") payment = { method: "online", cashPiasters: 0, onlinePiasters: total };
      else {
        const cash = egpInputToPiasters(cashEgp);
        const online = egpInputToPiasters(onlineEgp);
        if (cash === null || online === null || cash <= 0 || online <= 0 || cash + online !== total) {
          setError("أدخل مبلغ النقد والدفع الإلكتروني بحيث يساوي مجموعهما إجمالي البيع.");
          return null;
        }
        payment = { method: "split", cashPiasters: cash, onlinePiasters: online };
      }
    }
    return {
      customerName: customerName.trim() || null,
      customerPhone: customerPhone.trim() || null,
      couponCode: couponCode.trim().toLocaleUpperCase("en-US") || null,
      employeeDiscountPiasters: discountPiasters,
      discountReason: discountReason.trim() || null,
      ...(payment ? { payment } : {}),
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
      revisionBlockRef.current = false;
      setRevisionBlock(false);
    }
    if (recoveringForeign && !recoveringLocal) {
      setQuote(null);
    }
    setCompleted(sale);
    setNotice(messageAr);
    setError("");
    quoteOriginRef.current = null;
    quoteSnapshotRef.current = null;
    quoteCachedRef.current = null;
    void refreshBrowse();
  }

  async function assertLocalCartStock(lines: CartLine[]) {
    if (!workspace.activeBranch) throw new SalesValidationError("اختر فرع البيع أولاً.");
    const merged = mergeVariantQuantities(lines.map((line) => ({ variantId: line.variant.id, quantity: line.quantity })));
    for (const item of merged) {
      const source = lines.find((line) => line.variant.id === item.variantId);
      const cached = source?.variant.availableQuantity ?? 0;
      const available = await pos.availableQuantity(workspace.activeBranch.id, item.variantId, cached);
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
      reference: null,
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
      payment: { method: "cash", cashPiasters: priced.finalTotalPiasters, onlinePiasters: 0 },
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
            purpose: source.variant.id === source.product.operationalVariantId ? "operational" : "website_option",
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
          ...(payload.payment ? { payment: payload.payment } : {}),
          occurredAt,
          kind: "connected",
          snapshotId: null,
          ...(restoreGeneration !== null ? { restoreGeneration } : {}),
        }),
        quoteCachedRef.current ?? cachedQuantitiesFromCart(cart),
      );
      notifyPosStockChange({ staffId: recorded.staffId, branchId: recorded.branch.id });
      return saleFromOffline(recorded);
    }
    if (pinnedQuote && origin === "snapshot" && pinnedSnapshot) {
      const recorded = await pos.recordCompleted(
        offlineFromQuote({
          staffId: workspace.staff.id,
          deviceId: pinnedSnapshot.deviceId,
          quote: pinnedQuote,
          ...(payload.payment ? { payment: payload.payment } : {}),
          occurredAt,
          kind: "accepted",
          snapshotId: pinnedSnapshot.snapshotId,
          pricingVersion: pinnedSnapshot.pricingVersion === 1 ? 1 : null,
          restoreGeneration: pinnedSnapshot.restoreGeneration,
          pricingOccurredAt: pending.pricingOccurredAt ?? pinnedQuote.occurredAt,
        }),
        quoteCachedRef.current ?? cachedQuantitiesFromSnapshot(pinnedSnapshot),
      );
      notifyPosStockChange({ staffId: recorded.staffId, branchId: recorded.branch.id });
      return saleFromOffline(recorded);
    }
    throw new PosStorageError("لم تكتمل جاهزية نقطة البيع دون اتصال بعد.");
  }

  async function syncPersistedSale(saleId: string) {
    const generation = accountGeneration();
    const staffId = workspace.staff.id;
    const branchId = workspace.activeBranch?.id;
    const expectedContext = `${staffId}:${branchId ?? ""}`;
    const rows = await pos.listUnsynced(staffId);
    const local = rows.find((row) => row.id === saleId);
    if (!local || local.staffId !== staffId || local.branch.id !== branchId) {
      return;
    }
    try {
      const synced =
        local.kind === "accepted" && local.snapshotId
          ? await acceptOfflineSale(await acceptedPayload(local))
          : await completeSale(await completedPayload(local));
      await applySyncedSale(local, synced);
      if (
        browseMountedRef.current
        && accountGeneration() === generation
        && contextRef.current === expectedContext
      ) {
        setCompleted((current) => preservedSummaryReceipt(current, local.id, synced));
      }
      await refreshBrowse();
    } catch (caught) {
      setError(`${syncOutcomeMessage(caught)} البيع المكتمل محفوظ محلياً وسيظل ضمن المبيعات غير المرسلة.`);
    }
  }

  async function printPersistedReceipt(sale: SaleDto, generation: number, staffId: string, branchId: string | undefined) {
    const expectedContext = `${staffId}:${branchId ?? ""}`;
    const stillCurrent = () =>
      browseMountedRef.current
      && accountGeneration() === generation
      && contextRef.current === expectedContext;
    if (!stillCurrent() || !sale.physicallyCompleted) {
      return;
    }
    setReceiptError("");
    setReceiptStatus("جارٍ تجهيز الإيصال…");
    try {
      const result = await printCompletedBranchReceipt(sale, (message) => {
        if (stillCurrent()) setReceiptStatus(message);
      });
      if (!stillCurrent()) {
        return;
      }
      setReceiptStatus(receiptPrintStatus(result));
    } catch (caught) {
      if (!stillCurrent()) {
        return;
      }
      setReceiptStatus("");
      setReceiptError(receiptPrintFailureMessage(caught));
    }
  }

  async function submit(kind: "prepare" | "complete", options?: { print?: boolean }) {
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setPending(kind);
    setError("");
    setNotice("");
    if (kind === "complete") {
      setReceiptError("");
      setReceiptStatus("");
    }
    const epoch = revisionEpochRef.current;
    submitEpochRef.current = epoch;
    const generation = accountGeneration();
    const physical = kind === "complete";
    const alreadySaved = pendingSaleRef.current?.physicallyCompleted === true;
    if ((stockPause || restorePause) && (kind === "prepare" || !alreadySaved)) {
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
    const payload =
      physical && pendingSaleRef.current?.physicallyCompleted && frozenPayloadRef.current
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
    const editablePending = pendingSaleRef.current;
    if (kind === "prepare" && !editablePending?.physicallyCompleted &&
      (!editablePending || editablePending.phase === "prepared" || editablePending.phase === "rejected")) {
      // A known local shortage is an editable validation failure, before any
      // uncertain command is persisted or sent. Existing uncertain/paid records stay frozen.
      try {
        await assertLocalCartStock(cart);
      } catch (caught) {
        inFlightRef.current = false;
        setPending("");
        setError(caught instanceof SalesValidationError || caught instanceof PosStorageError
          ? caught.message : "تعذر التحقق من الكمية المتاحة. أعد المحاولة.");
        return;
      }
      if (accountGeneration() !== generation || revisionEpochRef.current !== epoch) {
        inFlightRef.current = false;
        setPending("");
        return;
      }
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
    const printAfterPersist = Boolean(physical && options?.print);
    let persistedForPrint: SaleDto | null = null;
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
            ? "تم تسليم البضاعة واستلام المبلغ. لا تطلب الدفع مرة أخرى. تحقق من النتيجة أو أعد المحاولة بنفس البيانات."
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
        await acceptSale(saved, "تم حفظ البيع.");
        void syncPersistedSale(saved.id);
        if (printAfterPersist && saved.physicallyCompleted) {
          persistedForPrint = saved;
        }
      } else {
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
      setNotice("تم قبول الأسعار.");
      }
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
          ? "تم تسليم البضاعة واستلام المبلغ. لا تطلب الدفع مرة أخرى. أعد المحاولة لحفظ البيع."
          : caught instanceof ApiError
            ? caught.messageAr
            : "تعذر حفظ البيع.",
      );
    } finally {
      inFlightRef.current = false;
      setPending("");
    }
    if (persistedForPrint) {
      await printPersistedReceipt(
        persistedForPrint,
        generation,
        workspace.staff.id,
        workspace.activeBranch?.id,
      );
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
        setError("تم تسليم البضاعة واستلام المبلغ. لا تطلب الدفع مرة أخرى. أعد المحاولة لحفظ البيع.");
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
          current.payload?.payment,
        ));
        if (recovered.physicallyCompleted) {
          await acceptSale(recovered, "تم حفظ البيع.");
        }
      } else if (!adoptQuote) {
        setError("تم تسليم البضاعة واستلام المبلغ. لا تطلب الدفع مرة أخرى. أعد المحاولة لحفظ البيع.");
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
      setNotice("تم استعادة الأسعار المقبولة.");
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
  const paymentBalancePiasters = quote && paymentMethod === "split"
    ? quote.finalTotalPiasters - (egpInputToPiasters(cashEgp) ?? 0) - (egpInputToPiasters(onlineEgp) ?? 0)
    : 0;
  const cartUnitCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cartListedTotal = cart.reduce((sum, line) => sum + line.variant.sellingPricePiasters * line.quantity, 0);
  const checkoutHasDetails = cart.length > 0 || Boolean(quote) || Boolean(pendingSale);

  return (
    <main className="shell pos-workspace">
      <header className="page-hero">
        <h1>نقطة البيع<span className="sr-only"> البحث عن منتج</span></h1>
        <p className="pos-branch-context">أصناف ومخزون {workspace.activeBranch?.nameAr}</p>
      </header>
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
      <div className="pos-layout">
      <div className="pos-discovery">
      <form
        className="card pos-scanner"
        aria-label="البحث برمز المنتج"
        aria-busy={pending === "search"}
        onSubmit={(event) => void onSearch(event)}
      >
        <div className="field">
          <label htmlFor="lookupCode">رمز المنتج</label>
          <input
            id="lookupCode"
            ref={scanInputRef}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={onScanKeyDown}
            placeholder="الكود الكامل للبحث المباشر"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            required
          />
        </div>
        <button type="submit" className="secondary" disabled={Boolean(pending)} aria-disabled={Boolean(pending)}>
          {pending === "search" ? "جارٍ البحث…" : "بحث"}
        </button>
        {searchError ? <div className="error" role="alert">{searchError}</div> : null}
        {pending === "search" ? <span className="sr-only" role="status">جارٍ البحث عن المنتج…</span> : null}
      </form>
      {product ? (
        <section className="card pos-selection" data-testid="lookup-result">
          <div className="pos-section-heading">
            <h2>{product.nameAr}</h2>
            <ProductLabelAction product={{ id: product.id, code: product.code, nameAr: product.nameAr }} />
          </div>
          <p className="muted">رمز المنتج: {product.code}</p>
          {selected ? (
            <div className="pos-selected-summary" data-testid="selected-variant">
              <div>
              <p>سعر البيع: {formatEgpFromPiasters(selected.sellingPricePiasters)}</p>
              <p data-testid="available-quantity">الكمية المتاحة في الفرع: {selectedEffective}</p>
              {product.minimumSellingPricePiasters !== null ? <p>الحد الأدنى للبيع: {formatEgpFromPiasters(product.minimumSellingPricePiasters)}</p> : null}
              </div>
              {selectedEffective === 0 ? (
                <p className="muted">غير متوفر في المخزون حتى يتم الاستلام.</p>
              ) : (
                <button type="button" data-testid="add-operational" disabled={formLocked || Boolean(stockPause) || Boolean(restorePause) || selectedCartQuantity >= selectedEffective} onClick={addSelected}>إضافة إلى السلة</button>
              )}
            </div>
          ) : (
            <p className="muted">حدّث قائمة المنتجات قبل البيع.</p>
          )}
        </section>
      ) : null}
      <ProductBrowser key={contextKey} products={browseProducts} quantities={effectiveByVariant} selectedId={product?.id} loading={browseLoading} message={browseMessage} onRetry={() => void refreshBrowse(true)} onSelect={(item) => {
        setProduct(item);
        setSizeFocusNonce((nonce) => nonce + 1);
      }} />
      </div>

      <form
        className="card pos-checkout"
        aria-label="إتمام البيع"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(pendingSale?.physicallyCompleted ? "complete" : "prepare");
        }}
      >
        <div className="pos-section-heading pos-checkout-heading"><h2>سلة البيع</h2><span className="muted">{cartUnitCount} قطعة</span></div>
        <div className="pos-checkout-body">
        {cart.length === 0 ? (
          <EmptyState title="السلة فاضية" message="اختر صنفاً من القائمة وأضفه بالكمية المتاحة في الفرع." />
        ) : (
          <ul className="pos-cart" data-testid="sale-cart">
            {cart.map((line) => (
              <li key={line.key}>
                <div><p className="pos-cart-name">{line.product.nameAr}</p>
                <p className="pos-cart-meta">{line.product.code}</p>
                <p className="pos-cart-meta">سعر الوحدة: {formatEgpFromPiasters(line.variant.sellingPricePiasters)}</p></div>
                <div className="field">
                  <label htmlFor={`qty-${line.key}`}>الكمية</label>
                  <input
                    id={`qty-${line.key}`}
                    type="number"
                    min={1}
                    max={Math.max(1, (effectiveByVariant[line.variant.id] ?? line.variant.availableQuantity) - cart.filter((item) => item.product.id === line.product.id && item.key !== line.key).reduce((sum, item) => sum + item.quantity, 0))}
                    value={line.quantity}
                    disabled={formLocked}
                    onChange={(event) => updateQuantity(line.key, Number(event.target.value))}
                  />
                </div>
                <button type="button" className="danger" disabled={formLocked} onClick={() => updateQuantity(line.key, 0)}>
                  حذف
                </button>
              </li>
            ))}
          </ul>
        )}
        {checkoutHasDetails ? <div className="pos-checkout-fields">
        <div className="field">
          <label htmlFor="customerName">اسم الزبون (اختياري)</label>
          <input id="customerName" value={customerName} disabled={formLocked} onChange={(event) => { if (beginCartRevision()) setCustomerName(event.target.value); }} />
        </div>
        <div className="field">
          <label htmlFor="customerPhone">هاتف الزبون (اختياري)</label>
          <input id="customerPhone" value={customerPhone} disabled={formLocked} onChange={(event) => { if (beginCartRevision()) { setSavedCustomer(null); setCustomerPhone(event.target.value); } }} />
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" disabled={formLocked || pending === "customer"} onClick={() => void findSavedCustomer()}>{pending === "customer" ? "جارٍ البحث…" : "بحث عن زبون محفوظ"}</button>
          {savedCustomer ? <button type="button" disabled={formLocked} onClick={() => { if (beginCartRevision()) setCustomerName(savedCustomer.displayName); }}>استخدام الاسم المحفوظ: {savedCustomer.displayName}</button> : null}
        </div>
        <div className="field">
          <label htmlFor="couponCode">كود الكوبون</label>
          <input id="couponCode" value={couponCode} disabled={formLocked} onChange={(event) => { if (beginCartRevision()) setCouponCode(event.target.value); }} />
        </div>
        <div className="field">
          <label htmlFor="discountEgp">خصم الموظف بالجنيه</label>
          <input id="discountEgp" value={discountEgp} disabled={formLocked} onChange={(event) => { if (beginCartRevision()) setDiscountEgp(event.target.value); }} />
        </div>
        <div className="field pos-field-wide">
          <label htmlFor="discountReason">سبب الخصم (اختياري)</label>
          <input id="discountReason" value={discountReason} disabled={formLocked} onChange={(event) => { if (beginCartRevision()) setDiscountReason(event.target.value); }} />
        </div>
        </div> : null}
        {quote ? (
          <section className="pos-accepted-prices" data-testid="accepted-prices">
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
        {quote ? (
          <fieldset className="field pos-payment" disabled={formLocked}>
            <legend>طريقة الدفع</legend>
            <label><input type="radio" name="payment-method" value="cash" checked={paymentMethod === "cash"} onChange={() => setPaymentMethod("cash")} /> نقداً بالكامل</label>
            <label><input type="radio" name="payment-method" value="online" checked={paymentMethod === "online"} onChange={() => setPaymentMethod("online")} /> إلكترونياً بالكامل (محفظة أو إنستا باي)</label>
            <label><input type="radio" name="payment-method" value="split" checked={paymentMethod === "split"} onChange={() => setPaymentMethod("split")} /> دفع مقسّم</label>
            {paymentMethod === "split" ? (
              <div className="grid two">
                <div className="field"><label htmlFor="payment-cash">المبلغ النقدي بالجنيه</label><input id="payment-cash" inputMode="decimal" value={cashEgp} onChange={(event) => setCashEgp(event.target.value)} /></div>
                <div className="field"><label htmlFor="payment-online">المبلغ الإلكتروني بالجنيه</label><input id="payment-online" inputMode="decimal" value={onlineEgp} onChange={(event) => setOnlineEgp(event.target.value)} /></div>
              </div>
            ) : null}
            <p role="status" data-testid="payment-remaining">
              {paymentBalancePiasters < 0 ? "المبلغ الزائد: " : "المتبقي: "}
              {formatEgpFromPiasters(Math.abs(paymentBalancePiasters))}
            </p>
          </fieldset>
        ) : null}
        </div>
        <div className="pos-checkout-footer">
        <p className="pos-cart-total"><span>{quote ? "الإجمالي المقبول" : "إجمالي الأصناف"}</span><strong>{formatEgpFromPiasters(quote?.finalTotalPiasters ?? cartListedTotal)}</strong></p>
        {!quote && cart.length > 0 ? <p className="pos-total-note">قبل العروض والكوبون وخصم الموظف. اقبل الأسعار لمعرفة المبلغ المستحق.</p> : null}
        {error ? <div className="error" role="alert">{error}</div> : null}
        {notice ? <div className="notice" role="status">{notice}</div> : null}
        {receiptStatus ? <p className="notice" role="status" data-testid="pos-receipt-status">{receiptStatus}</p> : null}
        {receiptError ? <p className="error" role="alert" data-testid="pos-receipt-error">{receiptError}</p> : null}
        <div className="actions">
          <button type="button" disabled={Boolean(stockPause) || Boolean(restorePause) || Boolean(pending) || cart.length === 0 || formLocked} onClick={() => void submit("prepare")}>
            {pending === "prepare" ? "جارٍ قبول الأسعار…" : "قبول الأسعار"}
          </button>
          {quote && !formLocked ? (
            <button type="button" className="secondary" onClick={() => beginCartRevision()}>
              إلغاء عرض السعر
            </button>
          ) : null}
          <button
            type="button"
            className="confirm pos-complete"
            data-testid="complete-sale"
            aria-labelledby="complete-without-print-label"
            aria-describedby="complete-without-print"
            disabled={((Boolean(stockPause) || Boolean(restorePause)) && !pendingSale?.physicallyCompleted) || Boolean(pending) || revisionBlock || (!quote && !pendingSale?.physicallyCompleted)}
            onClick={() => void submit("complete")}
          >
            <span id="complete-without-print-label">{pending === "complete" ? "جارٍ الحفظ…" : "إتمام البيع"}</span>
            <span id="complete-without-print">بدون طباعة</span>
          </button>
          <button
            type="button"
            className="confirm pos-complete"
            data-testid="complete-sale-print"
            disabled={((Boolean(stockPause) || Boolean(restorePause)) && !pendingSale?.physicallyCompleted) || Boolean(pending) || revisionBlock || (!quote && !pendingSale?.physicallyCompleted)}
            onClick={() => void submit("complete", { print: true })}
          >
            {pending === "complete" ? "جارٍ الحفظ…" : "حفظ البيع وطباعة الإيصال"}
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
        </div>
      </form>
      </div>

      {completed ? <SaleSummary key={completed.id} sale={completed} /> : null}
    </main>
  );
}
