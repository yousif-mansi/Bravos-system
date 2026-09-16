"use client";

import { useEffect, useRef } from "react";
import { recordPublicAnalyticsEvent } from "./analytics-events";

export function StorefrontVisitAnalytics() {
  const operationId = useRef<string | null>(null);

  useEffect(() => {
    operationId.current ??= crypto.randomUUID();
    void recordPublicAnalyticsEvent({ operationId: operationId.current, eventType: "visit" });
  }, []);

  return null;
}

export function ProductViewAnalytics({ productId }: { productId: string }) {
  const operation = useRef<{ productId: string; operationId: string } | null>(null);

  useEffect(() => {
    const current = operation.current?.productId === productId
      ? operation.current
      : { productId, operationId: crypto.randomUUID() };
    operation.current = current;
    void recordPublicAnalyticsEvent({
      operationId: current.operationId,
      eventType: "product_view",
      productId,
    });
  }, [productId]);

  return null;
}
