import type { AnalyticsSummaryDto } from "@bravos/contracts";
import type {
  PublicAnalyticsEventReceiptDto,
  PublicAnalyticsEventRequest,
  PublicProductDto,
} from "@bravos/contracts/public";
import type { AuthenticatedStaff, VerifiedAuth } from "@bravos/identity";
import type { AnalyticsPeriod } from "../domain/period.ts";

export type { VerifiedAuth };

export type AnalyticsActorPort = {
  getStaff(staffId: string): Promise<AuthenticatedStaff | null>;
};

export type AnalyticsCatalogPort = {
  getPublicProduct(productId: string): Promise<PublicProductDto>;
};

export type StoredAnalyticsEvent = PublicAnalyticsEventReceiptDto & {
  payloadFingerprint: string;
};

export type AnalyticsEventWrite = PublicAnalyticsEventRequest & {
  payloadFingerprint: string;
  recordedAt: Date;
};

export type AnalyticsEventCounts = {
  visits: number;
  productViews: number;
  successfulCartAdditions: number;
};

export type AnalyticsOrderFactsPort = {
  countAcceptedSubmissions(input: { from: Date; to: Date }): Promise<number>;
  countDeliveredFacts(input: { from: Date; to: Date }): Promise<number>;
};

export type AnalyticsStore = {
  getEvent(operationId: string): Promise<StoredAnalyticsEvent | null>;
  recordEvent(input: AnalyticsEventWrite): Promise<{ created: boolean; event: StoredAnalyticsEvent }>;
  countEvents(period: AnalyticsPeriod): Promise<AnalyticsEventCounts>;
};

export type AnalyticsServices = {
  recordPublicEvent(input: unknown): Promise<{ created: boolean; event: PublicAnalyticsEventReceiptDto }>;
  summary(auth: VerifiedAuth | null, query: unknown): Promise<AnalyticsSummaryDto>;
};
