import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  OnlineOrderAgreementQuoteDto,
  OnlineOrderDto,
  OnlineOrderSettingsDto,
  WorkspaceDto,
} from "@bravos/contracts";
import type { PublicProductDto, PublicProductSummaryDto } from "@bravos/contracts/public";
import { accountGeneration } from "../account-session.ts";
import { EmptyState } from "../ui/EmptyState.tsx";
import { PageLoading } from "../ui/PageLoading.tsx";
import { useRevealFeedback } from "../ui/useRevealFeedback.ts";
import {
  abandonOnlineOrderFailedReturnInspection,
  ApiError,
  cancelOnlineOrderBeforeShipment,
  cancelUnreachableOnlineOrder,
  closeOnlineOrderFailedDelivery,
  confirmOnlineOrder,
  deliverOnlineOrder,
  draftOnlineOrderFailedReturnInspection,
  getOnlineOrder,
  getOnlineOrderSettings,
  getPublicProduct,
  listOnlineOrders,
  markOnlineOrderDeliveryFailed,
  postOnlineOrderFailedReturnInspection,
  recordOnlineOrderContactAttempt,
  reviewOnlineOrderAgreement,
  saveOnlineOrderAgreement,
  searchPublicProducts,
  shipOnlineOrder,
  updateOnlineOrderSettings,
} from "../api.ts";
import { formatEgpFromPiasters } from "../money.ts";

type AgreementLineDraft = {
  variantId: string;
  productNameAr: string;
  sizeNameAr: string;
  colorNameAr: string;
  quantity: string;
};

type ContactPayload = {
  operationId: string;
  expectedRevision: number;
  outcome: "no_answer" | "reached";
  note?: string;
};

type AgreementPayload = {
  operationId: string;
  expectedRevision: number;
  quoteId: string;
  reviewDigest: string;
  customerAgreed: true;
};

type ConfirmationPayload = {
  operationId: string;
  expectedRevision: number;
  agreedRevision: number;
  itemsLocatedAndSetAside: true;
  fulfillmentBranchId: string;
};

type CancellationPayload = {
  operationId: string;
  expectedRevision: number;
  reason: string;
};

type RevisionPayload = {
  operationId: string;
  expectedRevision: number;
};

type InspectionPostPayload = RevisionPayload & { receivingBranchId: string };

type DeliveryPayload = RevisionPayload & {
  customerReceivedAt: string;
};

type OptionalReasonPayload = RevisionPayload & {
  reason?: string;
};

type ReasonPayload = RevisionPayload & {
  reason: string;
};

type BeforeShipmentCancellationPayload = ReasonPayload & { itemsReturnedAndInspected?: boolean };

type FailedInspectionPayload = RevisionPayload & {
  lines: Array<{ variantId: string; receivedQuantity: number; sellableQuantity: number }>;
};

type InspectionLineDraft = {
  receivedQuantity: string;
  sellableQuantity: string;
};

type PendingAttempt =
  | { action: "contact"; orderId: string; payload: ContactPayload }
  | { action: "agreement"; orderId: string; payload: AgreementPayload }
  | { action: "confirmation"; orderId: string; payload: ConfirmationPayload }
  | { action: "cancellation"; orderId: string; payload: CancellationPayload }
  | { action: "ship"; orderId: string; payload: RevisionPayload }
  | { action: "deliver"; orderId: string; payload: DeliveryPayload }
  | { action: "deliveryFailure"; orderId: string; payload: OptionalReasonPayload }
  | { action: "cancelBeforeShipment"; orderId: string; payload: BeforeShipmentCancellationPayload }
  | { action: "inspectionDraft"; orderId: string; payload: FailedInspectionPayload }
  | { action: "inspectionPost"; orderId: string; inspectionId: string; payload: InspectionPostPayload }
  | { action: "inspectionAbandon"; orderId: string; inspectionId: string; payload: ReasonPayload }
  | { action: "failedClose"; orderId: string; payload: ReasonPayload };

type PendingAction = PendingAttempt["action"];

const ATTEMPT_COPY = {
  contact: {
    title: "توجد محاولة تواصل لم نعرف نتيجتها",
    retry: "إعادة محاولة حفظ التواصل بنفس العملية",
    uncertain: "انقطع الرد وقد تكون محاولة التواصل حُفظت. أعد المحاولة بنفس العملية.",
    success: "تم تسجيل محاولة التواصل.",
  },
  agreement: {
    title: "توجد محاولة حفظ اتفاق لم نعرف نتيجتها",
    retry: "إعادة محاولة حفظ الاتفاق بنفس العملية",
    uncertain: "انقطع الرد وقد يكون الاتفاق حُفظ. أعد المحاولة بنفس العملية قبل إجراء تعديل جديد.",
    success: "تم حفظ الاتفاق مع العميل.",
  },
  confirmation: {
    title: "توجد محاولة تأكيد لم نعرف نتيجتها",
    retry: "إعادة محاولة التأكيد بنفس العملية",
    uncertain: "انقطع الرد وقد يكون التأكيد حُفظ. أعد تحميل الصفحة ثم أعد محاولة التأكيد بنفس العملية.",
    success: "تم تأكيد الطلب وخصم المخزون مرة واحدة.",
  },
  cancellation: {
    title: "توجد محاولة إلغاء لتعذر الوصول لم نعرف نتيجتها",
    retry: "إعادة محاولة الإلغاء لتعذر الوصول بنفس العملية",
    uncertain: "انقطع الرد وقد يكون إلغاء تعذر الوصول حُفظ. أعد المحاولة بنفس العملية.",
    success: "أُلغي الطلب يدوياً لتعذر الوصول إلى العميل.",
  },
  ship: {
    title: "توجد محاولة تسليم لشركة الشحن لم نعرف نتيجتها",
    retry: "إعادة محاولة التسليم لشركة الشحن بنفس العملية",
    uncertain: "انقطع الرد وقد يكون تسليم الطلب لشركة الشحن قد حُفظ. أعد المحاولة بنفس العملية.",
    success: "تم تسجيل تسليم الطلب لشركة الشحن من دون خصم جديد للمخزون.",
  },
  deliver: {
    title: "توجد محاولة تسجيل استلام العميل لم نعرف نتيجتها",
    retry: "إعادة محاولة تسجيل استلام العميل بنفس العملية",
    uncertain: "انقطع الرد وقد يكون استلام العميل قد حُفظ. أعد المحاولة بنفس العملية.",
    success: "تم تسجيل استلام العميل واكتمال الطلب.",
  },
  deliveryFailure: {
    title: "توجد محاولة تسجيل تعذر التوصيل لم نعرف نتيجتها",
    retry: "إعادة محاولة تسجيل تعذر التوصيل بنفس العملية",
    uncertain: "انقطع الرد وقد يكون تعذر التوصيل قد حُفظ. أعد المحاولة بنفس العملية.",
    success: "سُجل تعذر التوصيل وستظل الشحنة غير متاحة حتى استلامها وفحصها.",
  },
  cancelBeforeShipment: {
    title: "توجد محاولة إلغاء قبل الشحن لم نعرف نتيجتها",
    retry: "إعادة محاولة الإلغاء قبل الشحن بنفس العملية",
    uncertain: "انقطع الرد وقد يكون الإلغاء قبل الشحن قد حُفظ. أعد المحاولة بنفس العملية.",
    success: "أُلغي الطلب قبل الشحن وطُبقت الاستعادة المطلوبة مرة واحدة.",
  },
  inspectionDraft: {
    title: "توجد محاولة حفظ مسودة فحص لم نعرف نتيجتها",
    retry: "إعادة محاولة حفظ مسودة الفحص بنفس العملية",
    uncertain: "انقطع الرد وقد تكون مسودة الفحص قد حُفظت. أعد المحاولة بنفس العملية.",
    success: "حُفظت مسودة الفحص دون إعادة أي كمية للمخزون.",
  },
  inspectionPost: {
    title: "توجد محاولة ترحيل فحص لم نعرف نتيجتها",
    retry: "إعادة محاولة ترحيل الفحص بنفس العملية",
    uncertain: "انقطع الرد وقد يكون الفحص قد رُحّل. أعد المحاولة بنفس العملية.",
    success: "رُحّل الفحص واستُعيدت الكمية القابلة للبيع فقط.",
  },
  inspectionAbandon: {
    title: "توجد محاولة إلغاء مسودة فحص لم نعرف نتيجتها",
    retry: "إعادة محاولة إلغاء مسودة الفحص بنفس العملية",
    uncertain: "انقطع الرد وقد تكون مسودة الفحص أُلغيت. أعد المحاولة بنفس العملية.",
    success: "أُلغيت مسودة الفحص مع حفظها في السجل، ويمكن تسجيل فحص بديل.",
  },
  failedClose: {
    title: "توجد محاولة إغلاق نهائي لم نعرف نتيجتها",
    retry: "إعادة محاولة الإغلاق النهائي بنفس العملية",
    uncertain: "انقطع الرد وقد يكون الإغلاق النهائي قد حُفظ. أعد المحاولة بنفس العملية.",
    success: "أُغلق الطلب بعد استلام كامل الشحنة وفحصها.",
  },
} satisfies Record<PendingAction, { title: string; retry: string; uncertain: string; success: string }>;

export default function OnlineOrdersPage({ workspace }: { workspace: WorkspaceDto }) {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const lifecycle = useRef(0);
  const routeIdentity = `${workspace.staff.id}:${orderId ?? "list"}`;
  const currentRouteIdentity = useRef(routeIdentity);
  currentRouteIdentity.current = routeIdentity;
  const [orders, setOrders] = useState<OnlineOrderDto[]>([]);
  const [selected, setSelected] = useState<OnlineOrderDto | null>(null);
  const [settings, setSettings] = useState<OnlineOrderSettingsDto | null>(null);
  const [waitHours, setWaitHours] = useState("");
  const [minimumAttempts, setMinimumAttempts] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [readVersion, setReadVersion] = useState(0);
  const detailFeedback = useRevealFeedback<HTMLElement>();
  const [contactOutcome, setContactOutcome] = useState<"no_answer" | "reached">("no_answer");
  const [contactNote, setContactNote] = useState("");
  const [agreementLines, setAgreementLines] = useState<AgreementLineDraft[]>([]);
  const [couponCode, setCouponCode] = useState("");
  const [agreementQuote, setAgreementQuote] = useState<OnlineOrderAgreementQuoteDto | null>(null);
  const [customerAgreed, setCustomerAgreed] = useState(false);
  const [replacementQuery, setReplacementQuery] = useState("");
  const [replacementResults, setReplacementResults] = useState<PublicProductSummaryDto[]>([]);
  const [replacementProduct, setReplacementProduct] = useState<PublicProductDto | null>(null);
  const [replacementVariantId, setReplacementVariantId] = useState("");
  const [replacementQuantity, setReplacementQuantity] = useState("1");
  const [itemsSetAside, setItemsSetAside] = useState(false);
  const [fulfillmentBranchId, setFulfillmentBranchId] = useState(workspace.activeBranch?.id ?? workspace.authorizedBranches[0]?.id ?? "");
  const [confirmationNeedsReview, setConfirmationNeedsReview] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [preShipmentCancellationReason, setPreShipmentCancellationReason] = useState("");
  const [preShipmentItemsInspected, setPreShipmentItemsInspected] = useState(false);
  const [customerReceivedAt, setCustomerReceivedAt] = useState("");
  const [deliveryFailureReason, setDeliveryFailureReason] = useState("");
  const [inspectionDraft, setInspectionDraft] = useState<Record<string, InspectionLineDraft>>({});
  const [receivingBranchId, setReceivingBranchId] = useState(workspace.activeBranch?.id ?? workspace.authorizedBranches[0]?.id ?? "");
  const [inspectionAbandonReason, setInspectionAbandonReason] = useState("");
  const [failedCloseReason, setFailedCloseReason] = useState("");
  const [uncertainAttempt, setUncertainAttempt] = useState<PendingAttempt | null>(null);
  const manager = workspace.staff.role === "manager";

  useEffect(() => {
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = ++lifecycle.current;
    let cancelled = false;
    const stillCurrent = () => !cancelled
      && workspace.staff.id === staffId
      && accountGeneration() === epoch
      && lifecycle.current === token
      && currentRouteIdentity.current === routeIdentity;
    setLoading(true);
    setLoadFailed(false);
    setPending("");
    setError("");
    setNotice("");
    setSelected(null);
    setOrders([]);
    setSettings(null);
    setUncertainAttempt(orderId ? readPendingAttempt(staffId, orderId) : null);
    void (async () => {
      try {
        const [listed, order, currentSettings] = await Promise.all([
          listOnlineOrders(),
          orderId ? getOnlineOrder(orderId) : Promise.resolve(null),
          getOnlineOrderSettings(),
        ]);
        if (!stillCurrent()) return;
        setOrders(listed);
        setSelected(order);
        setSettings(currentSettings);
        setWaitHours(String(currentSettings.unreachableWaitHours));
        setMinimumAttempts(String(currentSettings.minimumContactAttempts));
        if (order) detailFeedback.reveal();
      } catch (caught) {
        if (stillCurrent()) { setLoadFailed(true); setError(errorMessage(caught, "تعذر تحميل الطلبات الأونلاين.")); }
      } finally {
        if (stillCurrent()) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (lifecycle.current === token) lifecycle.current += 1;
    };
  }, [workspace.staff.id, orderId, readVersion]);

  useEffect(() => {
    if (!selected) return;
    const source = selected.agreedRevision?.quote.lines ?? selected.lines.map((line) => ({
      variantId: line.variantId,
      productNameAr: line.productNameAr,
      sizeNameAr: line.sizeNameAr,
      colorNameAr: line.colorNameAr,
      quantity: line.requestedQuantity,
    }));
    setAgreementLines(source.map((line) => ({
      variantId: line.variantId,
      productNameAr: line.productNameAr,
      sizeNameAr: line.sizeNameAr,
      colorNameAr: line.colorNameAr,
      quantity: String(line.quantity),
    })));
    setCouponCode(selected.agreedRevision?.quote.couponCode ?? selected.requestedCouponCode ?? "");
    setAgreementQuote(null);
    setCustomerAgreed(false);
    setItemsSetAside(false);
    setConfirmationNeedsReview(false);
    setCancellationReason("");
  }, [selected?.id, selected?.agreedRevision?.version]);

  useEffect(() => {
    setPreShipmentCancellationReason("");
    setCustomerReceivedAt("");
    setDeliveryFailureReason("");
    setInspectionDraft({});
    setInspectionAbandonReason("");
    setFailedCloseReason("");
  }, [selected?.id]);

  useEffect(() => {
    if (!orderId) return;
    const key = attemptKey(workspace.staff.id, orderId);
    function onStorage(event: StorageEvent) {
      if (event.key !== key) return;
      setUncertainAttempt(readPendingAttempt(workspace.staff.id, orderId!));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [workspace.staff.id, orderId]);

  const cancellationReady = Boolean(
    selected
      && settings
      && selected.contactAttempts.filter((attempt) => attempt.outcome === "no_answer").length >= settings.minimumContactAttempts
      && Date.now() >= new Date(selected.submittedAt).getTime() + settings.unreachableWaitHours * 60 * 60 * 1000,
  );
  const selectedReplacement = replacementProduct?.variants.find((variant) => variant.id === replacementVariantId) ?? null;
  const agreementDraft = useMemo(() => validateAgreementLines(agreementLines), [agreementLines]);
  const reviewLines = agreementDraft.lines;
  const frozen = Boolean(uncertainAttempt || pending);
  const failedReturnLines = useMemo(() => selected ? remainingFailedReturnLines(selected) : [], [selected]);

  function replaceOrder(order: OnlineOrderDto) {
    setSelected(order);
    setOrders((current) => current.map((item) => item.id === order.id ? order : item));
  }

  async function refreshOrder() {
    if (!orderId) return;
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    const capturedRoute = routeIdentity;
    const order = await getOnlineOrder(orderId);
    if (
      workspace.staff.id === staffId
      && accountGeneration() === epoch
      && lifecycle.current === token
      && currentRouteIdentity.current === capturedRoute
    ) replaceOrder(order);
  }

  async function saveSettings() {
    if (!settings) return;
    const nextWait = Number(waitHours);
    const nextMinimum = Number(minimumAttempts);
    if (!Number.isInteger(nextWait) || nextWait < 1 || !Number.isInteger(nextMinimum) || nextMinimum < 2) {
      setError("أدخل مهلة صحيحة وعدداً صحيحاً لمحاولات التواصل.");
      return;
    }
    const result = await run("settings", () => updateOnlineOrderSettings({
        expectedRevision: settings.revision,
        unreachableWaitHours: nextWait,
        minimumContactAttempts: nextMinimum,
      }));
    if (!result) return;
    setSettings(result);
    setWaitHours(String(result.unreachableWaitHours));
    setMinimumAttempts(String(result.minimumContactAttempts));
    setNotice("تم حفظ إعدادات الطلبات.");
  }

  async function recordContact() {
    if (!selected) return;
    const note = contactNote.trim();
    await executeAttempt({
      action: "contact",
      orderId: selected.id,
      payload: {
        operationId: crypto.randomUUID(),
        expectedRevision: selected.revision,
        outcome: contactOutcome,
        ...(note ? { note } : {}),
      },
    });
  }

  async function searchReplacement() {
    const query = replacementQuery.trim();
    if (!query) return;
    const result = await run("search", () => searchPublicProducts(query));
    if (result) setReplacementResults(result.products.filter((product) => product.availability === "in_stock"));
  }

  async function chooseReplacement(productId: string) {
    const product = await run("replacement", () => getPublicProduct(productId));
    if (!product) return;
    setReplacementProduct(product);
    setReplacementVariantId(product.variants.find((variant) => variant.orderable)?.id ?? "");
    setReplacementQuantity("1");
  }

  function addReplacement() {
    if (!replacementProduct || !selectedReplacement || !selectedReplacement.orderable) return;
    const quantity = Number(replacementQuantity);
    const existingValue = agreementLines.find((line) => line.variantId === selectedReplacement.id)?.quantity ?? "0";
    const existingQuantity = Number(existingValue);
    if (
      !Number.isSafeInteger(quantity)
      || quantity < 1
      || !Number.isSafeInteger(existingQuantity)
      || existingQuantity < 0
      || existingQuantity + quantity > selectedReplacement.availableQuantity
    ) {
      setError("أدخل كمية صحيحة لا تتجاوز المتاح للصنف البديل.");
      return;
    }
    setAgreementLines((current) => {
      const existing = current.find((line) => line.variantId === selectedReplacement.id);
      if (existing) {
        return current.map((line) => line.variantId === selectedReplacement.id
          ? { ...line, quantity: String(Number(line.quantity || 0) + quantity) }
          : line);
      }
      return [...current, {
        variantId: selectedReplacement.id,
        productNameAr: replacementProduct.nameAr,
        sizeNameAr: selectedReplacement.size.nameAr,
        colorNameAr: selectedReplacement.color.nameAr,
        quantity: String(quantity),
      }];
    });
    invalidateAgreementReview();
    setReplacementProduct(null);
    setReplacementResults([]);
    setReplacementQuery("");
    setReplacementVariantId("");
    setNotice("أضيف الصنف البديل إلى مسودة الاتفاق. راجع السعر قبل حفظ موافقة العميل.");
  }

  async function reviewAgreement() {
    if (!selected || agreementDraft.error || reviewLines.length === 0) {
      setError(agreementDraft.error ?? "يجب أن يحتوي الاتفاق على صنف واحد على الأقل بكمية صحيحة.");
      return;
    }
    const result = await run("review", () => reviewOnlineOrderAgreement(selected.id, {
        expectedRevision: selected.revision,
        lines: reviewLines,
        ...(couponCode.trim() ? { couponCode: couponCode.trim() } : {}),
      }));
    if (!result) return;
    setAgreementQuote(result);
    setCustomerAgreed(false);
    setNotice("راجع المنتجات والأسعار مع العميل ثم سجل موافقته الصريحة.");
  }

  async function saveAgreement() {
    if (!selected || !agreementQuote || !customerAgreed) return;
    await executeAttempt({
      action: "agreement",
      orderId: selected.id,
      payload: {
        operationId: crypto.randomUUID(),
        expectedRevision: agreementQuote.orderRevision,
        quoteId: agreementQuote.quoteId,
        reviewDigest: agreementQuote.reviewDigest,
        customerAgreed: true,
      },
    });
  }

  async function confirm() {
    if (!selected?.agreedRevision || !itemsSetAside || !fulfillmentBranchId) return;
    await executeAttempt({
      action: "confirmation",
      orderId: selected.id,
      payload: {
        operationId: crypto.randomUUID(),
        expectedRevision: selected.revision,
        agreedRevision: selected.agreedRevision.version,
        itemsLocatedAndSetAside: true,
        fulfillmentBranchId,
      },
    });
  }

  async function cancelUnreachable() {
    if (!selected || !cancellationReason.trim()) return;
    await executeAttempt({
      action: "cancellation",
      orderId: selected.id,
      payload: {
        operationId: crypto.randomUUID(),
        expectedRevision: selected.revision,
        reason: cancellationReason.trim(),
      },
    });
  }

  async function ship() {
    if (!selected) return;
    await executeAttempt({
      action: "ship",
      orderId: selected.id,
      payload: { operationId: crypto.randomUUID(), expectedRevision: selected.revision },
    });
  }

  async function deliver() {
    if (!selected) return;
    const receivedAt = cairoWallTimeToIso(customerReceivedAt);
    if (!receivedAt) {
      setError("أدخل وقت استلام صحيح. متستخدمش ساعة مكررة أو مش موجودة.");
      return;
    }
    await executeAttempt({
      action: "deliver",
      orderId: selected.id,
      payload: {
        operationId: crypto.randomUUID(),
        expectedRevision: selected.revision,
        customerReceivedAt: receivedAt,
      },
    });
  }

  async function markDeliveryFailed() {
    if (!selected) return;
    const reason = deliveryFailureReason.trim();
    await executeAttempt({
      action: "deliveryFailure",
      orderId: selected.id,
      payload: {
        operationId: crypto.randomUUID(),
        expectedRevision: selected.revision,
        ...(reason ? { reason } : {}),
      },
    });
  }

  async function cancelBeforeShipment() {
    if (!selected || !preShipmentCancellationReason.trim()) return;
    await executeAttempt({
      action: "cancelBeforeShipment",
      orderId: selected.id,
      payload: {
        operationId: crypto.randomUUID(),
        expectedRevision: selected.revision,
        reason: preShipmentCancellationReason.trim(),
        ...(selected.status === "confirmed" ? { itemsReturnedAndInspected: preShipmentItemsInspected } : {}),
      },
    });
  }

  async function saveFailedInspection() {
    if (!selected) return;
    const result = validateInspectionDraft(failedReturnLines, inspectionDraft);
    if (result.error) {
      setError(result.error);
      return;
    }
    await executeAttempt({
      action: "inspectionDraft",
      orderId: selected.id,
      payload: {
        operationId: crypto.randomUUID(),
        expectedRevision: selected.revision,
        lines: result.lines,
      },
    });
  }

  async function postFailedInspection(inspectionId: string) {
    if (!selected || !receivingBranchId) return;
    await executeAttempt({
      action: "inspectionPost",
      orderId: selected.id,
      inspectionId,
      payload: { operationId: crypto.randomUUID(), expectedRevision: selected.revision, receivingBranchId },
    });
  }

  async function abandonFailedInspection(inspectionId: string) {
    if (!selected || !inspectionAbandonReason.trim()) return;
    await executeAttempt({
      action: "inspectionAbandon",
      orderId: selected.id,
      inspectionId,
      payload: {
        operationId: crypto.randomUUID(),
        expectedRevision: selected.revision,
        reason: inspectionAbandonReason.trim(),
      },
    });
  }

  async function closeFailedDelivery() {
    if (!selected || !failedCloseReason.trim()) return;
    await executeAttempt({
      action: "failedClose",
      orderId: selected.id,
      payload: {
        operationId: crypto.randomUUID(),
        expectedRevision: selected.revision,
        reason: failedCloseReason.trim(),
      },
    });
  }

  async function executeAttempt(candidate: PendingAttempt) {
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    const capturedRoute = routeIdentity;
    const stillCurrent = () => workspace.staff.id === staffId
      && accountGeneration() === epoch
      && lifecycle.current === token
      && currentRouteIdentity.current === capturedRoute;
    await withAttemptLock(staffId, candidate.orderId, async () => {
      if (!stillCurrent()) return;
      const saved = readPendingAttempt(staffId, candidate.orderId);
      if (saved && saved.payload.operationId !== candidate.payload.operationId) {
        setUncertainAttempt(saved);
        setError("توجد عملية سابقة لم نعرف نتيجتها. أعد محاولة العملية السابقة بنفس رقمها قبل بدء عملية جديدة.");
        setNotice("");
        return;
      }
      const attempt = saved ?? candidate;
      try {
        saveAttempt(staffId, attempt);
      } catch {
        if (stillCurrent()) {
          setError("تعذر حفظ محاولة العملية على هذا الجهاز، لذلك لم يتم إرسالها. حرر مساحة التخزين ثم حاول مرة أخرى.");
        }
        return;
      }
      if (stillCurrent()) {
        setUncertainAttempt(attempt);
        setPending(attempt.action);
        setError("");
        setNotice("");
      }
      try {
        const result = await dispatchAttempt(attempt);
        if (!stillCurrent()) return;
        clearAttempt(staffId, attempt);
        setUncertainAttempt(null);
        replaceOrder(result);
        if (attempt.action === "contact") {
          setContactNote("");
          setAgreementQuote(null);
          setCustomerAgreed(false);
        } else if (attempt.action === "agreement") {
          setAgreementQuote(null);
          setCustomerAgreed(false);
          setConfirmationNeedsReview(false);
        } else if (attempt.action === "confirmation") {
          setItemsSetAside(false);
        } else if (attempt.action === "cancellation") {
          setCancellationReason("");
        } else if (attempt.action === "deliver") {
          setCustomerReceivedAt("");
        } else if (attempt.action === "deliveryFailure") {
          setDeliveryFailureReason("");
        } else if (attempt.action === "cancelBeforeShipment") {
          setPreShipmentCancellationReason("");
          setPreShipmentItemsInspected(false);
        } else if (attempt.action === "inspectionDraft") {
          setInspectionDraft({});
        } else if (attempt.action === "inspectionAbandon") {
          setInspectionAbandonReason("");
        } else if (attempt.action === "failedClose") {
          setFailedCloseReason("");
        }
        setNotice(ATTEMPT_COPY[attempt.action].success);
      } catch (caught) {
        if (!stillCurrent()) return;
        if (caught instanceof ApiError && caught.status < 500) {
          clearAttempt(staffId, attempt);
          setUncertainAttempt(null);
          await refreshOrder().catch(() => undefined);
          if (!stillCurrent()) return;
          const direction = attempt.action === "confirmation" && caught.status === 409
            ? " راجع الاتفاق والسعر والمخزون مع العميل قبل محاولة تأكيد جديدة."
            : "";
          if (attempt.action === "confirmation" && caught.status === 409) {
            setItemsSetAside(false);
            setConfirmationNeedsReview(true);
          }
          setError(`${caught.messageAr}${direction}`);
        } else {
          setError(ATTEMPT_COPY[attempt.action].uncertain);
        }
      } finally {
        if (stillCurrent()) setPending("");
      }
    });
  }

  function dispatchAttempt(attempt: PendingAttempt) {
    switch (attempt.action) {
      case "contact":
        return recordOnlineOrderContactAttempt(attempt.orderId, attempt.payload);
      case "agreement":
        return saveOnlineOrderAgreement(attempt.orderId, attempt.payload);
      case "confirmation":
        return confirmOnlineOrder(attempt.orderId, attempt.payload);
      case "cancellation":
        return cancelUnreachableOnlineOrder(attempt.orderId, attempt.payload);
      case "ship":
        return shipOnlineOrder(attempt.orderId, attempt.payload).then((response) => response.result);
      case "deliver":
        return deliverOnlineOrder(attempt.orderId, attempt.payload).then((response) => response.result);
      case "deliveryFailure":
        return markOnlineOrderDeliveryFailed(attempt.orderId, attempt.payload).then((response) => response.result);
      case "cancelBeforeShipment":
        return cancelOnlineOrderBeforeShipment(attempt.orderId, attempt.payload).then((response) => response.result);
      case "inspectionDraft":
        return draftOnlineOrderFailedReturnInspection(attempt.orderId, attempt.payload).then((response) => response.result);
      case "inspectionPost":
        return postOnlineOrderFailedReturnInspection(attempt.orderId, attempt.inspectionId, attempt.payload).then((response) => response.result);
      case "inspectionAbandon":
        return abandonOnlineOrderFailedReturnInspection(attempt.orderId, attempt.inspectionId, attempt.payload).then((response) => response.result);
      case "failedClose":
        return closeOnlineOrderFailedDelivery(attempt.orderId, attempt.payload).then((response) => response.result);
      default:
        return assertNever(attempt);
    }
  }

  async function run<T>(action: string, work: () => Promise<T>): Promise<T | null> {
    const staffId = workspace.staff.id;
    const epoch = accountGeneration();
    const token = lifecycle.current;
    const capturedRoute = routeIdentity;
    const stillCurrent = () => workspace.staff.id === staffId
      && accountGeneration() === epoch
      && lifecycle.current === token
      && currentRouteIdentity.current === capturedRoute;
    setPending(action);
    setError("");
    setNotice("");
    try {
      const result = await work();
      return stillCurrent() ? result : null;
    } catch (caught) {
      if (stillCurrent()) setError(errorMessage(caught, "تعذر إكمال العملية."));
      return null;
    } finally {
      if (stillCurrent()) setPending("");
    }
  }

  function invalidateAgreementReview() {
    setAgreementQuote(null);
    setCustomerAgreed(false);
  }

  if (loading) {
    return <PageLoading />;
  }

  return (
    <main className="shell online-orders-page">
      <header className="page-hero">
        <h1>الطلبات الأونلاين</h1>
      </header>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="notice" role="status">{notice}</div> : null}
      {pending ? <p role="status">{pendingCopy(pending)}</p> : null}
      {loadFailed ? <section className="card"><button type="button" onClick={() => setReadVersion((version) => version + 1)}>إعادة تحميل {orderId ? "تفاصيل الطلب" : "الطلبات"}</button></section> : null}

      {loadFailed ? null : !orderId ? (
        <>
          {manager && settings ? (
            <form className="card order-settings" aria-label="إعدادات تعذر الوصول" onSubmit={(event) => { event.preventDefault(); void saveSettings(); }}>
              <h2>إعدادات تعذر الوصول</h2>
              <p className="muted">الإلغاء يدوي فقط بعد انقضاء المهلة وتسجيل العدد الأدنى من المحاولات مع سبب.</p>
              <div className="grid two">
                <div className="field">
                  <label htmlFor="order-wait-hours">مهلة تعذر الوصول بالساعات</label>
                  <input id="order-wait-hours" type="number" min="1" step="1" value={waitHours} onChange={(event) => setWaitHours(event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="order-minimum-attempts">الحد الأدنى لمحاولات التواصل</label>
                  <input id="order-minimum-attempts" type="number" min="2" step="1" value={minimumAttempts} onChange={(event) => setMinimumAttempts(event.target.value)} />
                </div>
              </div>
              <button type="submit" disabled={Boolean(pending)}>{pending === "settings" ? pendingCopy(pending) : "حفظ الإعدادات"}</button>
            </form>
          ) : null}
          <section className="card">
            <h2>طلبات العملاء</h2>
            {orders.length === 0 ? <EmptyState title="لسه مفيش طلبات" message="أول ما عميل يطلب، الطلب هيظهر هنا." /> : (
              <div className="list-stack">
                {orders.map((order) => (
                  <article className="summary-card online-order-row" data-testid="online-order-row" key={order.id}>
                    <div>
                      <strong>{order.reference}</strong>
                      <p>{order.customerName} — {statusLabel(order.status)}</p>
                      <p className="muted">{formatDate(order.submittedAt)} — {formatEgpFromPiasters(order.agreedRevision?.quote.finalTotalPiasters ?? order.requestedFinalTotalPiasters)}</p>
                    </div>
                    <Link className="button secondary" to={`/online-orders/${order.id}`}>فتح التفاصيل</Link>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : selected ? (
        <>
          <div className="actions order-back"><button className="secondary" type="button" onClick={() => navigate("/online-orders")}>العودة إلى الطلبات</button></div>
          <section ref={detailFeedback.regionRef} className={`card order-heading reveal-feedback${detailFeedback.highlighted ? " is-highlighted" : ""}`}>
            <div>
              <h2 ref={detailFeedback.headingRef} tabIndex={-1}>{selected.reference}</h2>
              <p id="order-status" data-testid="order-status">الحالة: {statusLabel(selected.status)}</p>
              {selected.confirmedAt ? <p>أكد الطلب المسؤول {selected.confirmedByStaffId} في {formatDate(selected.confirmedAt)}.</p> : null}
              {selected.fulfillmentBranchId ? <p>فرع التجهيز: {workspace.authorizedBranches.find((branch) => branch.id === selected.fulfillmentBranchId)?.nameAr ?? selected.fulfillmentBranchId}</p> : null}
              {selected.cancelledAt ? <p>ألغاه المسؤول {selected.cancelledByStaffId} في {formatDate(selected.cancelledAt)} — {selected.cancellationReason}</p> : null}
            </div>
            <p className="muted">أُرسل {formatDate(selected.submittedAt)} — إصدار الطلب {selected.revision}</p>
          </section>

          {uncertainAttempt ? (
            <section className="notice uncertain-order-attempt">
              <h2>{ATTEMPT_COPY[uncertainAttempt.action].title}</h2>
              <p>احتفظ النظام بنفس رقم العملية ونفس القيم. أعد المحاولة لمعرفة النتيجة دون تكرار الأثر.</p>
              <button type="button" disabled={Boolean(pending)} onClick={() => void executeAttempt(uncertainAttempt)}>
                {ATTEMPT_COPY[uncertainAttempt.action].retry}
              </button>
            </section>
          ) : null}

          <section className="card" role="region" aria-label="الطلب الأصلي">
            <h2>الطلب الأصلي كما أرسله العميل</h2>
            <div className="grid two order-customer-details">
              <div><strong>العميل</strong><p>{selected.customerName}</p></div>
              <div>
                <strong>الموبايل الأساسي</strong>
                <p dir="ltr">{selected.primaryPhone}</p>
                <a href={whatsappUrl(selected.primaryPhone)} target="_blank" rel="noreferrer">فتح واتساب</a>
              </div>
              <div><strong>رقم بديل</strong><p dir="ltr">{selected.alternatePhone ?? "غير مسجل"}</p></div>
              <div><strong>منطقة التوصيل</strong><p>{selected.deliveryArea.nameAr}</p></div>
              <div><strong>العنوان</strong><p>{selected.detailedAddress}</p></div>
              <div><strong>علامة مميزة</strong><p>{selected.landmark ?? "غير مسجلة"}</p></div>
              <div><strong>ملاحظات العميل</strong><p>{selected.notes ?? "لا توجد"}</p></div>
            </div>
            <OrderLines
              lines={selected.lines.map((line) => ({
                key: line.id,
                name: line.productNameAr,
                variant: `${line.sizeNameAr} / ${line.colorNameAr}`,
                quantity: line.requestedQuantity,
                total: line.requestedMerchandiseTotalPiasters,
                quantityLabel: "الكمية المطلوبة",
              }))}
            />
            <PriceSummary
              original={selected.requestedMerchandiseOriginalPiasters}
              automatic={selected.requestedAutomaticOfferDiscountPiasters}
              coupon={selected.requestedCouponDiscountPiasters}
              merchandise={selected.requestedMerchandiseTotalPiasters}
              delivery={selected.requestedDeliveryFeePiasters}
              final={selected.requestedFinalTotalPiasters}
            />
            <PromotionSummary
              offer={selected.requestedAppliedAutomaticOffer}
              coupon={selected.requestedAppliedCoupon}
            />
          </section>

          <section className="card" data-testid="contact-attempts">
            <h2>محاولات التواصل</h2>
            {selected.contactAttempts.length === 0 ? <p className="empty">لم تُسجل محاولة تواصل بعد.</p> : selected.contactAttempts.map((attempt) => (
              <article className="history-item" key={attempt.id}>
                <strong>{attempt.outcome === "reached" ? "تم التواصل" : "لا توجد إجابة"}</strong>
                <p>{attempt.note ?? "من دون ملاحظة"}</p>
                <p className="muted">{formatDate(attempt.occurredAt)} — المسؤول {attempt.actorStaffId}</p>
              </article>
            ))}
          </section>

          {selected.agreedRevision ? <AgreementSnapshot quote={selected.agreedRevision.quote} agreedAt={selected.agreedRevision.agreedAt} actorId={selected.agreedRevision.agreedByStaffId} /> : null}

          <OrderTimeline order={selected} />

          {selected.actionEligibility.canShip ? (
            <section className="card fulfillment-card" aria-label="تسليم الطلب للشحن">
              <h2>تسليم الطلب لشركة الشحن</h2>
              <p>المخزون خُصم وحُمي عند التأكيد. تسجيل الشحن لا يخصمه مرة أخرى.</p>
              <button type="button" disabled={frozen} onClick={() => void ship()}>{pending === "ship" ? pendingCopy(pending) : "تسليم الطلب لشركة الشحن"}</button>
            </section>
          ) : null}

          {selected.actionEligibility.canDeliver ? (
            <form className="card fulfillment-card" aria-label="تسجيل استلام العميل" onSubmit={(event) => { event.preventDefault(); void deliver(); }}>
              <h2>استلام العميل</h2>
              <p className="muted">سجّل الوقت الفعلي الذي استلم فيه العميل الطلب. وقت التسجيل في النظام يُحفظ منفصلاً.</p>
              <div className="field">
                <label htmlFor="customer-received-at">وقت استلام العميل</label>
                <input id="customer-received-at" type="datetime-local" step="1" value={customerReceivedAt} disabled={frozen} onChange={(event) => setCustomerReceivedAt(event.target.value)} required />
              </div>
              <button type="submit" disabled={frozen || !customerReceivedAt}>{pending === "deliver" ? pendingCopy(pending) : "تسجيل الطلب كمُسلّم"}</button>
            </form>
          ) : null}

          {selected.actionEligibility.canMarkDeliveryFailed ? (
            <form className="card failed-delivery-card" aria-label="تسجيل تعذر التوصيل" onSubmit={(event) => { event.preventDefault(); void markDeliveryFailed(); }}>
              <h2>تعذر التوصيل</h2>
              <p>تظل كل أصناف الشحنة غير متاحة حتى تعود فعلياً، ثم تُفحص ويُرحّل المدير نتيجة الفحص.</p>
              <div className="field">
                <label htmlFor="delivery-failure-reason">سبب تعذر التوصيل (اختياري)</label>
                <textarea id="delivery-failure-reason" value={deliveryFailureReason} disabled={frozen} onChange={(event) => setDeliveryFailureReason(event.target.value)} />
              </div>
              <button type="submit" className="danger" disabled={frozen}>تسجيل تعذر التوصيل وانتظار رجوع الشحنة</button>
            </form>
          ) : null}

          {selected.actionEligibility.canCancelBeforeShipment ? (
            <form className="card cancellation-card" aria-label={selected.status === "pending" ? "إلغاء طلب معلق قبل الشحن" : "إلغاء طلب مؤكد قبل الشحن"} onSubmit={(event) => { event.preventDefault(); void cancelBeforeShipment(); }}>
              <h2>إلغاء قبل الشحن</h2>
              <p>
                {selected.status === "confirmed"
                  ? "يُلغى البيع الآن. تبقى الأصناف محمية من البيع حتى استلامها وفحصها، ثم تُعاد الكمية الصالحة فقط للمخزون."
                  : "هذا الطلب لم يحجز مخزوناً ولم يستهلك كوبوناً، لذلك لا توجد كمية أو استخدام لاستعادتهما."}
              </p>
              <div className="field">
                <label htmlFor="pre-shipment-cancellation-reason">سبب الإلغاء قبل الشحن</label>
                <textarea id="pre-shipment-cancellation-reason" value={preShipmentCancellationReason} disabled={frozen} onChange={(event) => setPreShipmentCancellationReason(event.target.value)} required />
              </div>
              {selected.status === "confirmed" ? <label className="checkbox-row"><input type="checkbox" checked={preShipmentItemsInspected} disabled={frozen} onChange={(event) => setPreShipmentItemsInspected(event.target.checked)} />استلمت جميع الأصناف وفحصتها وهي صالحة للبيع</label> : null}
              <button className="danger" type="submit" disabled={frozen || !preShipmentCancellationReason.trim()}>
                {selected.status === "confirmed" ? "إلغاء الطلب" : "إلغاء الطلب من دون تغيير المخزون"}
              </button>
            </form>
          ) : null}

          {selected.status === "delivery_failed"
            || (selected.status === "cancelled_before_shipment" && selected.preShipmentStockDisposition === "awaiting_inspection")
            || selected.failedReturnInspections.length > 0 ? (
            <FailedReturnInspections
              order={selected}
              remainingLines={failedReturnLines}
              frozen={frozen}
              draft={inspectionDraft}
              onDraftChange={(variantId, value) => setInspectionDraft((current) => ({ ...current, [variantId]: value }))}
              onSaveDraft={() => void saveFailedInspection()}
              onPost={(inspectionId) => void postFailedInspection(inspectionId)}
              receivingBranchId={receivingBranchId}
              receivingBranches={workspace.authorizedBranches}
              onReceivingBranchChange={setReceivingBranchId}
              abandonReason={inspectionAbandonReason}
              onAbandonReasonChange={setInspectionAbandonReason}
              onAbandon={(inspectionId) => void abandonFailedInspection(inspectionId)}
            />
          ) : null}

          {selected.actionEligibility.canCloseFailedDelivery ? (
            <form className="card cancellation-card" aria-label="إغلاق الطلب المتعذر نهائياً" onSubmit={(event) => { event.preventDefault(); void closeFailedDelivery(); }}>
              <h2>إغلاق الطلب بعد رجوع الشحنة</h2>
              <p>
                {selected.confirmedQuote?.appliedCoupon
                  ? "أصبحت كل الوحدات مستلمة ومصنفة. الإغلاق النهائي يلغي الطلب ويتيح استخدام الكوبون مرة واحدة."
                  : "أصبحت كل الوحدات مستلمة ومصنفة. الإغلاق النهائي ينهي الطلب من دون أي استعادة مخزون إضافية."}
              </p>
              <div className="field">
                <label htmlFor="failed-close-reason">سبب الإغلاق النهائي</label>
                <textarea id="failed-close-reason" value={failedCloseReason} disabled={frozen} onChange={(event) => setFailedCloseReason(event.target.value)} required />
              </div>
              <button className="danger" type="submit" disabled={frozen || !failedCloseReason.trim()}>إغلاق الطلب نهائياً</button>
            </form>
          ) : null}

          {selected.status === "pending" ? (
            <>
              <form className="card" aria-label="تسجيل محاولة تواصل" onSubmit={(event) => { event.preventDefault(); void recordContact(); }}>
                <h2>تسجيل محاولة تواصل</h2>
                <div className="field">
                  <label htmlFor="contact-outcome">نتيجة التواصل</label>
                  <select id="contact-outcome" value={contactOutcome} disabled={frozen} onChange={(event) => setContactOutcome(event.target.value as typeof contactOutcome)}>
                    <option value="no_answer">لا توجد إجابة</option>
                    <option value="reached">تم التواصل</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="contact-note">ملاحظة التواصل (اختياري)</label>
                  <textarea id="contact-note" value={contactNote} disabled={frozen} onChange={(event) => setContactNote(event.target.value)} />
                </div>
                <button type="submit" disabled={frozen}>{pending === "contact" ? pendingCopy(pending) : "حفظ محاولة التواصل"}</button>
              </form>

              <form className="card" aria-label="مراجعة الاتفاق مع العميل" onSubmit={(event) => { event.preventDefault(); void reviewAgreement(); }}>
                <h2>مراجعة الاتفاق مع العميل</h2>
                <p className="muted">عدّل الكميات أو أضف بديلاً وافق عليه العميل. الصفر يحذف الصنف من الاتفاق الجديد.</p>
                {agreementLines.map((line) => (
                  <div className="agreement-line" key={line.variantId}>
                    <div><strong>{line.productNameAr}</strong><p className="muted">{line.sizeNameAr} / {line.colorNameAr}</p></div>
                    <div className="field compact-field">
                      <label htmlFor={`agreement-quantity-${line.variantId}`}>الكمية</label>
                      <input
                        id={`agreement-quantity-${line.variantId}`}
                        data-testid={`agreement-quantity-${line.variantId}`}
                        type="number"
                        min="0"
                        step="1"
                        value={line.quantity}
                        disabled={frozen}
                        onChange={(event) => {
                          setAgreementLines((current) => current.map((item) => item.variantId === line.variantId ? { ...item, quantity: event.target.value } : item));
                          invalidateAgreementReview();
                        }}
                      />
                    </div>
                  </div>
                ))}
                <div className="replacement-picker">
                  <h3>إضافة صنف بديل اتفق عليه العميل</h3>
                  <div className="field">
                    <label htmlFor="replacement-query">بحث عن منتج بديل</label>
                    <input id="replacement-query" value={replacementQuery} disabled={frozen} onChange={(event) => setReplacementQuery(event.target.value)} />
                  </div>
                  <button className="secondary" type="button" disabled={frozen || !replacementQuery.trim()} onClick={() => void searchReplacement()}>بحث</button>
                  {replacementResults.map((product) => (
                    <article className="summary-card" data-testid="replacement-product" key={product.id}>
                      <div><strong>{product.nameAr}</strong><p className="muted">{product.category.nameAr}</p></div>
                      <button className="secondary" type="button" disabled={frozen} onClick={() => void chooseReplacement(product.id)}>اختيار</button>
                    </article>
                  ))}
                  {replacementProduct ? (
                    <div className="replacement-variant">
                      <div className="field">
                        <label htmlFor="replacement-variant">الصنف البديل</label>
                        <select id="replacement-variant" value={replacementVariantId} disabled={frozen} onChange={(event) => setReplacementVariantId(event.target.value)}>
                          {replacementProduct.variants.filter((variant) => variant.orderable).map((variant) => (
                            <option key={variant.id} value={variant.id}>{variant.size.nameAr} / {variant.color.nameAr} — متاح {variant.availableQuantity}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="replacement-quantity">كمية الصنف البديل</label>
                        <input id="replacement-quantity" type="number" min="1" max={selectedReplacement?.availableQuantity} step="1" value={replacementQuantity} disabled={frozen} onChange={(event) => setReplacementQuantity(event.target.value)} />
                      </div>
                      <button type="button" disabled={frozen || !replacementVariantId} onClick={addReplacement}>إضافة الصنف البديل</button>
                    </div>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="agreement-coupon">كود الكوبون المتفق عليه (اختياري)</label>
                  <input id="agreement-coupon" value={couponCode} disabled={frozen} onChange={(event) => { setCouponCode(event.target.value); invalidateAgreementReview(); }} />
                </div>
                {agreementDraft.error ? <p className="error" data-testid="agreement-quantity-error">{agreementDraft.error}</p> : null}
                <button type="submit" disabled={frozen || Boolean(agreementDraft.error) || reviewLines.length === 0}>{pending === "review" ? pendingCopy(pending) : "مراجعة السعر"}</button>
                {agreementQuote ? (
                  <div className="price-review" role="region" aria-label="مراجعة السعر المتفق عليه">
                    <h3>مراجعة السعر قبل تسجيل موافقة العميل</h3>
                    <OrderLines lines={agreementQuote.lines.map((line) => ({
                      key: line.variantId,
                      name: line.productNameAr,
                      variant: `${line.sizeNameAr} / ${line.colorNameAr}`,
                      quantity: line.quantity,
                      total: line.merchandiseTotalPiasters,
                      quantityLabel: "الكمية",
                    }))} />
                    <PriceSummary
                      original={agreementQuote.merchandiseOriginalPiasters}
                      automatic={agreementQuote.automaticOfferDiscountPiasters}
                      coupon={agreementQuote.couponDiscountPiasters}
                      merchandise={agreementQuote.merchandiseTotalPiasters}
                      delivery={agreementQuote.deliveryFeePiasters}
                      final={agreementQuote.finalTotalPiasters}
                    />
                    <PromotionSummary offer={agreementQuote.appliedAutomaticOffer} coupon={agreementQuote.appliedCoupon} />
                    <label className="checkbox-row">
                      <input type="checkbox" checked={customerAgreed} disabled={frozen} onChange={(event) => setCustomerAgreed(event.target.checked)} />
                      وافق العميل على هذه المنتجات والأسعار
                    </label>
                    <button type="button" disabled={frozen || !customerAgreed} onClick={() => void saveAgreement()}>{pending === "agreement" ? pendingCopy(pending) : "حفظ اتفاق العميل"}</button>
                  </div>
                ) : null}
              </form>

              {selected.agreedRevision ? (
                <form className="card confirmation-card" aria-label="تأكيد تجهيز الطلب" onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
                  <h2>تأكيد تجهيز الطلب</h2>
                  <p>طابق الأصناف الفعلية مع الاتفاق الحالي وافصلها عن المخزون المتاح قبل التأكيد.</p>
                  {confirmationNeedsReview ? <p className="error">يلزم إنشاء مراجعة سعر جديدة وحفظ موافقة العميل قبل التأكيد.</p> : null}
                  <div className="field"><label htmlFor="online-fulfillment-branch">فرع تجهيز الطلب</label><select id="online-fulfillment-branch" value={fulfillmentBranchId} disabled={frozen || confirmationNeedsReview} onChange={(event) => { setFulfillmentBranchId(event.target.value); setItemsSetAside(false); }} required>{workspace.authorizedBranches.filter((branch) => manager || branch.id === workspace.activeBranch?.id).map((branch) => <option key={branch.id} value={branch.id}>{branch.nameAr}</option>)}</select></div>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={itemsSetAside} disabled={frozen || confirmationNeedsReview} onChange={(event) => setItemsSetAside(event.target.checked)} />
                    وجدت الأصناف الفعلية وفصلتها لهذا الطلب
                  </label>
                  <button type="submit" disabled={frozen || confirmationNeedsReview || !itemsSetAside || !fulfillmentBranchId}>{pending === "confirmation" ? pendingCopy(pending) : "تأكيد الطلب وخصم المخزون"}</button>
                </form>
              ) : (
                <p className="card muted">لا يمكن تأكيد الطلب قبل حفظ اتفاق العميل على المنتجات والأسعار.</p>
              )}

              <form className="card cancellation-card" aria-label="إلغاء طلب لتعذر الوصول" onSubmit={(event) => { event.preventDefault(); void cancelUnreachable(); }}>
                <h2>إلغاء يدوي لتعذر الوصول</h2>
                <p>
                  يتطلب {settings?.minimumContactAttempts ?? "—"} محاولات بلا إجابة على الأقل وانتظار {settings?.unreachableWaitHours ?? "—"} ساعة من استلام الطلب.
                  لا يحدث إلغاء تلقائي.
                </p>
                <div className="field">
                  <label htmlFor="cancellation-reason">سبب إلغاء تعذر الوصول</label>
                  <textarea id="cancellation-reason" value={cancellationReason} disabled={frozen} onChange={(event) => setCancellationReason(event.target.value)} required />
                </div>
                <button className="danger" type="submit" disabled={frozen || !cancellationReady || !cancellationReason.trim()}>إلغاء يدوياً لتعذر الوصول</button>
                {!cancellationReady ? <p className="muted">لم تكتمل المهلة ومحاولات التواصل المطلوبة بعد.</p> : null}
              </form>
            </>
          ) : null}
        </>
      ) : (
        <section className="card"><p className="empty">لم يتم العثور على الطلب.</p></section>
      )}
    </main>
  );
}

function pendingCopy(action: string) {
  const copy: Record<string, string> = {
    settings: "جارٍ حفظ الإعدادات…", search: "جارٍ البحث عن الأصناف…", replacement: "جارٍ تحميل الصنف البديل…",
    review: "جارٍ مراجعة السعر…", contact: "جارٍ حفظ محاولة التواصل…", agreement: "جارٍ حفظ اتفاق العميل…",
    confirmation: "جارٍ تأكيد الطلب…", cancellation: "جارٍ إلغاء الطلب…", ship: "جارٍ تسجيل تسليم الشحنة…",
    deliver: "جارٍ تسجيل استلام العميل…", deliveryFailure: "جارٍ تسجيل تعذر التوصيل…",
    cancelBeforeShipment: "جارٍ إلغاء الطلب قبل الشحن…", inspectionDraft: "جارٍ حفظ مسودة الفحص…",
    inspectionPost: "جارٍ ترحيل الفحص…", inspectionAbandon: "جارٍ إلغاء مسودة الفحص…", failedClose: "جارٍ إغلاق الطلب…",
  };
  return copy[action] ?? "جارٍ إكمال العملية…";
}

function AgreementSnapshot({ quote, agreedAt, actorId }: { quote: OnlineOrderAgreementQuoteDto; agreedAt: string; actorId: string }) {
  return (
    <section className="card agreed-order" role="region" aria-label="الاتفاق الحالي مع العميل">
      <h2>الاتفاق الحالي مع العميل</h2>
      <OrderLines lines={quote.lines.map((line) => ({
        key: line.variantId,
        name: line.productNameAr,
        variant: `${line.sizeNameAr} / ${line.colorNameAr}`,
        quantity: line.quantity,
        total: line.merchandiseTotalPiasters,
        quantityLabel: "الكمية",
      }))} />
      <PriceSummary
        original={quote.merchandiseOriginalPiasters}
        automatic={quote.automaticOfferDiscountPiasters}
        coupon={quote.couponDiscountPiasters}
        merchandise={quote.merchandiseTotalPiasters}
        delivery={quote.deliveryFeePiasters}
        final={quote.finalTotalPiasters}
      />
      <PromotionSummary offer={quote.appliedAutomaticOffer} coupon={quote.appliedCoupon} />
      <p className="muted">وافق العميل {formatDate(agreedAt)} — المسؤول {actorId}</p>
    </section>
  );
}

function OrderTimeline({ order }: { order: OnlineOrderDto }) {
  return (
    <section className="card" role="region" aria-label="سجل تنفيذ الطلب">
      <h2>سجل تنفيذ الطلب</h2>
      <div className="fulfillment-timeline">
        <article className="history-item">
          <strong>استلام طلب العميل</strong>
          <p className="muted">{formatDate(order.submittedAt)}</p>
        </article>
        {order.lifecycle.map((event) => (
          <article className="history-item" key={event.id}>
            <strong>{lifecycleLabel(event.type)}</strong>
            <p>من {statusLabel(event.fromStatus)} إلى {statusLabel(event.toStatus)}</p>
            {event.reason ? <p>السبب: {event.reason}</p> : null}
            <p className="muted">حدث {formatDate(event.occurredAt)} — المسؤول {event.actorStaffId}</p>
            {event.recordedAt !== event.occurredAt ? <p className="muted">سُجل في النظام {formatDate(event.recordedAt)}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

type RemainingFailedReturnLine = {
  variantId: string;
  productNameAr: string;
  sizeNameAr: string;
  colorNameAr: string;
  confirmedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
};

function FailedReturnInspections({
  order,
  remainingLines,
  frozen,
  draft,
  onDraftChange,
  onSaveDraft,
  onPost,
  receivingBranchId,
  receivingBranches,
  onReceivingBranchChange,
  abandonReason,
  onAbandonReasonChange,
  onAbandon,
}: {
  order: OnlineOrderDto;
  remainingLines: RemainingFailedReturnLine[];
  frozen: boolean;
  draft: Record<string, InspectionLineDraft>;
  onDraftChange: (variantId: string, value: InspectionLineDraft) => void;
  onSaveDraft: () => void;
  onPost: (inspectionId: string) => void;
  receivingBranchId: string;
  receivingBranches: WorkspaceDto["authorizedBranches"];
  onReceivingBranchChange: (branchId: string) => void;
  abandonReason: string;
  onAbandonReasonChange: (value: string) => void;
  onAbandon: (inspectionId: string) => void;
}) {
  const remainingTotal = remainingLines.reduce((sum, line) => sum + line.remainingQuantity, 0);
  const lineNames = new Map((order.confirmedQuote?.lines ?? []).map((line) => [line.variantId, `${line.productNameAr} — ${line.sizeNameAr} / ${line.colorNameAr}`]));
  return (
    <section className="card failed-return-card" role="region" aria-label="فحوصات الشحنة المرتجعة">
      <h2>استلام وفحص الشحنة المرتجعة</h2>
      <p className="failed-return-remaining" data-testid="failed-return-remaining">المتبقي خارج المحل: {remainingTotal}</p>
      <p className="muted">المسودة تسجل ما وصل فعلياً فقط. لا تعيد الكمية للمخزون حتى يراجع المدير الفحص ويرحّله.</p>

      {order.failedReturnInspections.length === 0 ? <p className="empty">لم تصل أي كمية للفحص بعد.</p> : (
        <div className="inspection-history">
          {order.failedReturnInspections.map((inspection) => (
            <article className="inspection-record" key={inspection.id}>
              <div className="inspection-heading">
                <strong>{inspection.status === "draft" ? "مسودة بانتظار الترحيل أو الإلغاء" : inspection.status === "posted" ? "فحص مرحّل" : "مسودة ملغاة"}</strong>
                <span>{formatDate(inspection.recordedAt)}</span>
              </div>
              {inspection.lines.map((line) => (
                <p key={line.variantId}>
                  {lineNames.get(line.variantId) ?? line.variantId}: استُلم {line.receivedQuantity}، قابل للبيع {line.sellableQuantity}، غير قابل للبيع {line.nonsellableQuantity}
                </p>
              ))}
              <p className="muted">سجله المسؤول {inspection.recordedByStaffId}</p>
              {inspection.postedAt ? <p className="muted">رحّله المدير {inspection.postedByStaffId} في {formatDate(inspection.postedAt)} · فرع الاستلام: {receivingBranches.find((branch) => branch.id === inspection.receivingBranchId)?.nameAr ?? "—"}</p> : null}
              {inspection.abandonedAt ? <p className="muted">ألغاه المسؤول {inspection.abandonedByStaffId} في {formatDate(inspection.abandonedAt)} — {inspection.abandonmentReason}</p> : null}
              {inspection.status === "draft" && order.actionEligibility.canPostFailedReturnInspection ? (
                <div><div className="field"><label htmlFor={`inspection-receiving-branch-${inspection.id}`}>فرع استلام الشحنة</label><select id={`inspection-receiving-branch-${inspection.id}`} value={receivingBranchId} disabled={frozen} onChange={(event) => onReceivingBranchChange(event.target.value)} required>{receivingBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.nameAr}</option>)}</select></div><button type="button" disabled={frozen || !receivingBranchId} onClick={() => onPost(inspection.id)}>ترحيل الفحص واستعادة القابل للبيع</button></div>
              ) : null}
              {inspection.status === "draft" && order.actionEligibility.canAbandonFailedReturnInspection ? (
                <form className="inspection-abandon" aria-label="إلغاء مسودة الفحص واستبدالها" onSubmit={(event) => { event.preventDefault(); onAbandon(inspection.id); }}>
                  <div className="field">
                    <label htmlFor={`inspection-abandon-reason-${inspection.id}`}>سبب إلغاء مسودة الفحص</label>
                    <textarea id={`inspection-abandon-reason-${inspection.id}`} value={abandonReason} disabled={frozen} onChange={(event) => onAbandonReasonChange(event.target.value)} required />
                  </div>
                  <button className="secondary" type="submit" disabled={frozen || !abandonReason.trim()}>إلغاء المسودة وتسجيل فحص بديل</button>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {order.actionEligibility.canDraftFailedReturnInspection ? (
        <form className="inspection-draft" aria-label="تسجيل استلام وفحص الشحنة المرتجعة" onSubmit={(event) => { event.preventDefault(); onSaveDraft(); }}>
          <h3>مسودة فحص جديدة</h3>
          {remainingLines.filter((line) => line.remainingQuantity > 0).map((line) => {
            const value = draft[line.variantId] ?? { receivedQuantity: "0", sellableQuantity: "0" };
            return (
              <fieldset className="inspection-line" key={line.variantId}>
                <legend>{line.productNameAr} — {line.sizeNameAr} / {line.colorNameAr}</legend>
                <p>المؤكد: {line.confirmedQuantity} · وصل سابقاً: {line.receivedQuantity} · المتبقي خارج المحل: {line.remainingQuantity}</p>
                <div className="grid two">
                  <div className="field">
                    <label htmlFor={`inspection-received-${line.variantId}`}>الكمية المستلمة</label>
                    <input id={`inspection-received-${line.variantId}`} type="number" min="0" max={line.remainingQuantity} step="1" value={value.receivedQuantity} disabled={frozen} onChange={(event) => onDraftChange(line.variantId, { ...value, receivedQuantity: event.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`inspection-sellable-${line.variantId}`}>منها قابلة للبيع</label>
                    <input id={`inspection-sellable-${line.variantId}`} type="number" min="0" max={value.receivedQuantity || "0"} step="1" value={value.sellableQuantity} disabled={frozen} onChange={(event) => onDraftChange(line.variantId, { ...value, sellableQuantity: event.target.value })} />
                  </div>
                </div>
              </fieldset>
            );
          })}
          <button type="submit" disabled={frozen || remainingTotal === 0}>حفظ مسودة الفحص</button>
        </form>
      ) : null}
    </section>
  );
}

function PromotionSummary({ offer, coupon }: {
  offer: { nameAr: string; discountPiasters: number } | null;
  coupon: { code: string; discountPiasters: number } | null;
}) {
  if (!offer && !coupon) return <p className="muted">لا يوجد عرض أو كوبون مطبق.</p>;
  return (
    <div className="order-promotions">
      {offer ? <p>العرض: {offer.nameAr} — {formatEgpFromPiasters(offer.discountPiasters)}</p> : null}
      {coupon ? <p>الكوبون: {coupon.code} — {formatEgpFromPiasters(coupon.discountPiasters)}</p> : null}
    </div>
  );
}

function OrderLines({ lines }: { lines: Array<{ key: string; name: string; variant: string; quantity: number; total: number; quantityLabel: string }> }) {
  return (
    <div className="order-lines">
      {lines.map((line) => (
        <article className="order-line" key={line.key}>
          <div><strong>{line.name}</strong><p className="muted">{line.variant}</p></div>
          <p>{line.quantityLabel}: {line.quantity}</p>
          <p>{formatEgpFromPiasters(line.total)}</p>
        </article>
      ))}
    </div>
  );
}

function PriceSummary({ original, automatic, coupon, merchandise, delivery, final }: {
  original: number;
  automatic: number;
  coupon: number;
  merchandise: number;
  delivery: number;
  final: number;
}) {
  return (
    <dl className="order-price-summary">
      <div><dt>المنتجات قبل الخصم</dt><dd>{formatEgpFromPiasters(original)}</dd></div>
      <div><dt>خصم العرض</dt><dd>{formatEgpFromPiasters(automatic)}</dd></div>
      <div><dt>خصم الكوبون</dt><dd>{formatEgpFromPiasters(coupon)}</dd></div>
      <div><dt>إجمالي المنتجات</dt><dd>{formatEgpFromPiasters(merchandise)}</dd></div>
      <div><dt>رسوم التوصيل:</dt><dd>{formatEgpFromPiasters(delivery)}</dd></div>
      <div className="order-final"><dt>الإجمالي النهائي:</dt><dd>{formatEgpFromPiasters(final)}</dd></div>
    </dl>
  );
}

function statusLabel(status: OnlineOrderDto["status"]) {
  switch (status) {
    case "pending": return "بانتظار التأكيد";
    case "confirmed": return "مؤكد";
    case "shipped": return "تم الشحن";
    case "delivered": return "تم التسليم";
    case "delivery_failed": return "تعذر التوصيل — بانتظار رجوع الشحنة";
    case "cancelled_unreachable": return "ملغي لتعذر الوصول";
    case "cancelled_before_shipment": return "ملغي قبل الشحن";
    case "cancelled_after_failed_delivery": return "ملغي بعد رجوع الشحنة وفحصها";
    default: return assertNever(status);
  }
}

function lifecycleLabel(type: OnlineOrderDto["lifecycle"][number]["type"]) {
  switch (type) {
    case "confirmed": return "تأكيد الطلب وحماية أصنافه";
    case "shipped": return "تم الشحن";
    case "delivered": return "استلام العميل للطلب";
    case "delivery_failed": return "تعذر التوصيل";
    case "cancelled_unreachable": return "إلغاء لتعذر الوصول";
    case "cancelled_before_shipment": return "إلغاء قبل الشحن";
    case "failed_return_inspection_drafted": return "حفظ مسودة فحص الشحنة";
    case "failed_return_inspection_posted": return "ترحيل فحص الشحنة";
    case "failed_return_inspection_abandoned": return "إلغاء مسودة فحص الشحنة";
    case "cancelled_after_failed_delivery": return "إغلاق الطلب بعد رجوع الشحنة";
    default: return assertNever(type);
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" });
}

function whatsappUrl(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits.startsWith("0") ? `20${digits.slice(1)}` : digits}`;
}

function errorMessage(caught: unknown, fallback: string) {
  if (caught instanceof ApiError) return caught.messageAr;
  if (caught instanceof Error && caught.message) return caught.message;
  return fallback;
}

function attemptKey(staffId: string, orderId: string) {
  return `bravos.online-order.pending.${staffId}.${orderId}`;
}

function readPendingAttempt(staffId: string, orderId: string): PendingAttempt | null {
  try {
    const raw = localStorage.getItem(attemptKey(staffId, orderId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingAttempt;
    if (!validAttemptAction(parsed.action) || parsed.orderId !== orderId || !validAttemptPayload(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function validAttemptAction(value: unknown): value is PendingAttempt["action"] {
  return typeof value === "string" && Object.hasOwn(ATTEMPT_COPY, value);
}

function validAttemptPayload(attempt: PendingAttempt) {
  if (typeof attempt.payload?.operationId !== "string" || typeof attempt.payload.expectedRevision !== "number") return false;
  switch (attempt.action) {
    case "contact":
      return (attempt.payload.outcome === "no_answer" || attempt.payload.outcome === "reached")
        && (attempt.payload.note === undefined || typeof attempt.payload.note === "string");
    case "agreement":
      return typeof attempt.payload.quoteId === "string"
        && typeof attempt.payload.reviewDigest === "string"
        && attempt.payload.customerAgreed === true;
    case "confirmation":
      return typeof attempt.payload.agreedRevision === "number" && attempt.payload.itemsLocatedAndSetAside === true
        && typeof attempt.payload.fulfillmentBranchId === "string";
    case "cancellation":
    case "inspectionAbandon":
    case "failedClose":
      return typeof attempt.payload.reason === "string";
    case "cancelBeforeShipment":
      return typeof attempt.payload.reason === "string"
        && (attempt.payload.itemsReturnedAndInspected === undefined || attempt.payload.itemsReturnedAndInspected === true);
    case "ship":
      return true;
    case "deliver":
      return typeof attempt.payload.customerReceivedAt === "string";
    case "deliveryFailure":
      return attempt.payload.reason === undefined || typeof attempt.payload.reason === "string";
    case "inspectionPost":
      return typeof attempt.inspectionId === "string" && typeof attempt.payload.receivingBranchId === "string";
    case "inspectionDraft":
      return Array.isArray(attempt.payload.lines) && attempt.payload.lines.every((line) => (
        typeof line.variantId === "string"
        && Number.isSafeInteger(line.receivedQuantity)
        && line.receivedQuantity > 0
        && Number.isSafeInteger(line.sellableQuantity)
        && line.sellableQuantity >= 0
        && line.sellableQuantity <= line.receivedQuantity
      ));
    default:
      return assertNever(attempt);
  }
}

function saveAttempt(staffId: string, attempt: PendingAttempt) {
  localStorage.setItem(attemptKey(staffId, attempt.orderId), JSON.stringify(attempt));
}

function clearAttempt(staffId: string, attempt: PendingAttempt) {
  const current = readPendingAttempt(staffId, attempt.orderId);
  if (current?.payload.operationId === attempt.payload.operationId) {
    localStorage.removeItem(attemptKey(staffId, attempt.orderId));
  }
}

async function withAttemptLock<T>(staffId: string, orderId: string, work: () => T | Promise<T>): Promise<T> {
  if (navigator.locks?.request) {
    return await navigator.locks.request(
      `bravos.online-order.lock.${staffId}.${orderId}`,
      { mode: "exclusive" },
      work,
    );
  }
  return await work();
}

function validateAgreementLines(lines: AgreementLineDraft[]): {
  lines: Array<{ variantId: string; quantity: number }>;
  error: string | null;
} {
  const accepted: Array<{ variantId: string; quantity: number }> = [];
  for (const line of lines) {
    if (!line.quantity.trim()) {
      return { lines: [], error: `أدخل كمية ${line.productNameAr} أو اكتب صفر لحذف الصنف من الاتفاق.` };
    }
    const quantity = Number(line.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1_000_000) {
      return { lines: [], error: `كمية ${line.productNameAr} يجب أن تكون عدداً صحيحاً غير سالب.` };
    }
    if (quantity > 0) accepted.push({ variantId: line.variantId, quantity });
  }
  return { lines: accepted, error: null };
}

function remainingFailedReturnLines(order: OnlineOrderDto): RemainingFailedReturnLine[] {
  const confirmed = order.confirmedQuote?.lines ?? [];
  const received = new Map<string, number>();
  for (const inspection of order.failedReturnInspections) {
    if (inspection.status === "abandoned") continue;
    for (const line of inspection.lines) {
      received.set(line.variantId, (received.get(line.variantId) ?? 0) + line.receivedQuantity);
    }
  }
  const aggregated = new Map<string, RemainingFailedReturnLine>();
  for (const line of confirmed) {
    const existing = aggregated.get(line.variantId);
    if (existing) {
      existing.confirmedQuantity += line.quantity;
      continue;
    }
    aggregated.set(line.variantId, {
      variantId: line.variantId,
      productNameAr: line.productNameAr,
      sizeNameAr: line.sizeNameAr,
      colorNameAr: line.colorNameAr,
      confirmedQuantity: line.quantity,
      receivedQuantity: 0,
      remainingQuantity: 0,
    });
  }
  return [...aggregated.values()].map((line) => {
    const receivedQuantity = received.get(line.variantId) ?? 0;
    return {
      ...line,
      receivedQuantity,
      remainingQuantity: Math.max(0, line.confirmedQuantity - receivedQuantity),
    };
  });
}

function validateInspectionDraft(
  remainingLines: RemainingFailedReturnLine[],
  draft: Record<string, InspectionLineDraft>,
): {
  lines: Array<{ variantId: string; receivedQuantity: number; sellableQuantity: number }>;
  error: string | null;
} {
  const accepted: Array<{ variantId: string; receivedQuantity: number; sellableQuantity: number }> = [];
  for (const line of remainingLines) {
    const value = draft[line.variantId] ?? { receivedQuantity: "0", sellableQuantity: "0" };
    const receivedQuantity = Number(value.receivedQuantity);
    const sellableQuantity = Number(value.sellableQuantity);
    if (!Number.isSafeInteger(receivedQuantity) || receivedQuantity < 0 || receivedQuantity > line.remainingQuantity) {
      return { lines: [], error: `الكمية المستلمة من ${line.productNameAr} يجب أن تكون عدداً صحيحاً لا يتجاوز ${line.remainingQuantity}.` };
    }
    if (!Number.isSafeInteger(sellableQuantity) || sellableQuantity < 0 || sellableQuantity > receivedQuantity) {
      return { lines: [], error: `الكمية القابلة للبيع من ${line.productNameAr} يجب ألا تتجاوز الكمية المستلمة.` };
    }
    if (receivedQuantity > 0) accepted.push({ variantId: line.variantId, receivedQuantity, sellableQuantity });
  }
  return accepted.length > 0
    ? { lines: accepted, error: null }
    : { lines: [], error: "سجّل كمية مستلمة واحدة على الأقل قبل حفظ مسودة الفحص." };
}

function cairoWallTimeToIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const desired = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0"),
  };
  const desiredParts = [desired.year, desired.month, desired.day, desired.hour, desired.minute, desired.second];
  const wallClockAsUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute, desired.second);
  const offsets = new Set<number>();
  for (const deltaHours of [-36, -24, -12, 0, 12, 24, 36]) {
    const offset = cairoOffsetMinutes(new Date(wallClockAsUtc + deltaHours * 60 * 60 * 1000));
    if (offset !== null) offsets.add(offset);
  }
  const matches = [...offsets]
    .map((offset) => new Date(wallClockAsUtc - offset * 60_000))
    .filter((candidate) => cairoParts(candidate).every((part, index) => part === desiredParts[index]));
  return matches.length === 1 ? matches[0]!.toISOString() : null;
}

function cairoOffsetMinutes(instant: Date) {
  const offsetPart = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    timeZoneName: "longOffset",
  }).formatToParts(instant).find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offsetPart ?? "");
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "+" ? minutes : -minutes;
}

function cairoParts(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const value = (type: "year" | "month" | "day" | "hour" | "minute" | "second") => Number(parts.find((part) => part.type === type)?.value);
  return [value("year"), value("month"), value("day"), value("hour"), value("minute"), value("second")];
}

function assertNever(value: never): never {
  throw new Error(`Unhandled online-order action: ${String(value)}`);
}
