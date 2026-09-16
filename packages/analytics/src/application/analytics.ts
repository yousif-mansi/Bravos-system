import { createHash } from "node:crypto";
import type { AnalyticsSummaryDto } from "@bravos/contracts";
import type {
  PublicAnalyticsEventRequest,
  PublicAnalyticsEventReceiptDto,
  PublicAnalyticsEventType,
} from "@bravos/contracts/public";
import { ForbiddenError, UnauthenticatedError, isManager } from "@bravos/identity";
import { AnalyticsOperationConflictError, AnalyticsValidationError } from "../domain/errors.ts";
import { parseAnalyticsPeriod } from "../domain/period.ts";
import type {
  AnalyticsActorPort,
  AnalyticsCatalogPort,
  AnalyticsOrderFactsPort,
  AnalyticsServices,
  AnalyticsStore,
} from "./ports.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_KEYS: Record<PublicAnalyticsEventType, ReadonlySet<string>> = {
  visit: new Set(["operationId", "eventType"]),
  product_view: new Set(["operationId", "eventType", "productId"]),
  cart_addition: new Set(["operationId", "eventType", "productId", "variantId", "quantity"]),
};

export function createAnalyticsServices(input: {
  actors: AnalyticsActorPort;
  catalog: AnalyticsCatalogPort;
  orders: AnalyticsOrderFactsPort;
  store: AnalyticsStore;
  clock?: { now(): Date };
}): AnalyticsServices {
  const clock = input.clock ?? { now: () => new Date() };

  return {
    async recordPublicEvent(rawInput: unknown) {
      const event = parseEvent(rawInput);
      const payloadFingerprint = fingerprint(event);
      const replay = await input.store.getEvent(event.operationId);
      if (replay) return replayResult(replay, payloadFingerprint);

      await validateLiveEvent(input.catalog, event);
      const saved = await input.store.recordEvent({ ...event, payloadFingerprint, recordedAt: clock.now() });
      if (saved.event.payloadFingerprint !== payloadFingerprint) throw new AnalyticsOperationConflictError();
      return { created: saved.created, event: receipt(saved.event) };
    },

    async summary(auth, rawQuery) {
      await requireManager(input.actors, auth);
      const period = parseAnalyticsPeriod(rawQuery);
      const range = { from: period.from, to: period.toExclusive };
      const [events, acceptedOrderSubmissions, completedOnlineSales] = await Promise.all([
        input.store.countEvents(period),
        input.orders.countAcceptedSubmissions(range),
        input.orders.countDeliveredFacts(range),
      ]);
      const counts = { ...events, acceptedOrderSubmissions, completedOnlineSales };
      return {
        period: {
          fromCairoDate: period.fromCairoDate,
          toCairoDateInclusive: period.toCairoDateInclusive,
        },
        metrics: {
          visits: metric(counts.visits, "مرة لكل تحميل كامل للمتجر في المتصفح قبلها الخادم؛ التنقل بين صفحات المتجر دون إعادة تحميل لا يُحتسب مرة أخرى، ولا تمثل زواراً فريدين."),
          productViews: metric(counts.productViews, "طلبات عرض منتج منشور التي قبلها الخادم؛ لا تمثل أشخاصاً فريدين."),
          successfulCartAdditions: metric(
            counts.successfulCartAdditions,
            "إضافات السلة التي أبلغ عنها المتصفح وقبلها الخادم بعد فحص المنتج والكمية وقت وصول الحدث؛ لا تمثل أشخاصاً فريدين.",
          ),
          acceptedOrderSubmissions: metric(
            counts.acceptedOrderSubmissions,
            "طلبات الشراء المقبولة والمحفوظة، محسوبة مرة واحدة بهوية عملية الإرسال.",
          ),
          completedOnlineSales: metric(
            counts.completedOnlineSales,
            "طلبات الأونلاين التي اكتمل بيعها عند تسجيل التسليم، محسوبة مرة واحدة لكل طلب.",
          ),
        },
      } satisfies AnalyticsSummaryDto;
    },
  };
}

async function requireManager(actors: AnalyticsActorPort, auth: Parameters<AnalyticsServices["summary"]>[0]) {
  if (!auth) throw new UnauthenticatedError();
  const staff = await actors.getStaff(auth.staffId);
  if (!staff || staff.disabled) throw new UnauthenticatedError();
  if (!isManager(staff)) throw new ForbiddenError();
}

function parseEvent(value: unknown): PublicAnalyticsEventRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AnalyticsValidationError("بيانات حدث التحليلات غير صالحة.");
  }
  const body = value as Record<string, unknown>;
  const eventType = body.eventType;
  if (eventType !== "visit" && eventType !== "product_view" && eventType !== "cart_addition") {
    throw new AnalyticsValidationError("نوع حدث التحليلات غير صالح.");
  }
  if (Object.keys(body).some((key) => !EVENT_KEYS[eventType].has(key))) {
    throw new AnalyticsValidationError("بيانات حدث التحليلات غير صالحة.");
  }
  const operationId = uuid(body.operationId, "هوية حدث التحليلات غير صالحة.");
  if (eventType === "visit") return { operationId, eventType };
  const productId = uuid(body.productId, "هوية المنتج غير صالحة.");
  if (eventType === "product_view") return { operationId, eventType, productId };
  const variantId = uuid(body.variantId, "هوية متغير المنتج غير صالحة.");
  const quantity = body.quantity;
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
    throw new AnalyticsValidationError("كمية إضافة السلة غير صالحة.");
  }
  return { operationId, eventType, productId, variantId, quantity };
}

async function validateLiveEvent(catalog: AnalyticsCatalogPort, event: PublicAnalyticsEventRequest): Promise<void> {
  if (event.eventType === "visit") return;
  const product = await catalog.getPublicProduct(event.productId);
  if (event.eventType === "product_view") return;
  const variant = product.variants.find((item) => item.id === event.variantId);
  if (!product.orderable || !variant?.orderable || event.quantity > variant.availableQuantity) {
    throw new AnalyticsValidationError("لم يقبل المتجر إضافة هذه الكمية إلى السلة.");
  }
}

function fingerprint(event: PublicAnalyticsEventRequest): string {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function replayResult(
  replay: { payloadFingerprint: string } & PublicAnalyticsEventReceiptDto,
  payloadFingerprint: string,
) {
  if (replay.payloadFingerprint !== payloadFingerprint) throw new AnalyticsOperationConflictError();
  return { created: false, event: receipt(replay) };
}

function receipt(event: PublicAnalyticsEventReceiptDto): PublicAnalyticsEventReceiptDto {
  return { operationId: event.operationId, eventType: event.eventType, recordedAt: event.recordedAt };
}

function uuid(value: unknown, messageAr: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new AnalyticsValidationError(messageAr);
  return value.toLowerCase();
}

function metric(count: number, definitionAr: string) {
  return { count, definitionAr };
}
