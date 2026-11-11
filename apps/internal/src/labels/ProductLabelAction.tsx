import { useEffect, useRef, useState } from "react";

import { accountGeneration, subscribeAccount } from "../account-session.ts";
import "./product-label.css";

export type ProductLabelActionProduct = {
  id: string;
  code: string;
  nameAr: string;
  defaultSellingPricePiasters: number | null;
};

type ProductLabelDialogComponent = typeof import("./ProductLabelDialog.tsx").ProductLabelDialog;

export function ProductLabelAction({
  product,
  disabled = false,
}: {
  product: ProductLabelActionProduct;
  disabled?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const [Dialog, setDialog] = useState<ProductLabelDialogComponent | null>(null);
  const [openProduct, setOpenProduct] = useState<ProductLabelActionProduct | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  useEffect(() => subscribeAccount(() => {
    requestRef.current += 1;
    setOpenProduct(null);
    setPhase("idle");
  }), []);

  function close() {
    requestRef.current += 1;
    setOpenProduct(null);
    setPhase("idle");
    queueMicrotask(() => {
      const trigger = triggerRef.current;
      if (trigger && document.contains(trigger)) trigger.focus();
    });
  }

  async function open() {
    const generation = accountGeneration();
    const requestId = ++requestRef.current;
    const snapshot = {
      id: product.id,
      code: product.code,
      nameAr: product.nameAr,
      defaultSellingPricePiasters: product.defaultSellingPricePiasters,
    };
    setPhase("loading");
    setOpenProduct(null);
    try {
      const module = await import("./ProductLabelDialog.tsx");
      const stillCurrent = mountedRef.current
        && requestId === requestRef.current
        && accountGeneration() === generation;
      if (!stillCurrent) return;
      setDialog(() => module.ProductLabelDialog);
      setOpenProduct(snapshot);
      setPhase("idle");
    } catch {
      const stillCurrent = mountedRef.current
        && requestId === requestRef.current
        && accountGeneration() === generation;
      if (!stillCurrent) return;
      setOpenProduct(null);
      setPhase("error");
    }
  }

  const loading = phase === "loading";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="secondary product-label-open"
        data-testid="product-label-open"
        aria-label={`طباعة باركود ${product.code}`}
        aria-busy={loading}
        disabled={disabled || loading}
        onClick={() => void open()}
      >
        طباعة باركود
      </button>
      {loading ? <p className="product-label-status" role="status">جارٍ الفتح…</p> : null}
      {phase === "error" ? (
        <div className="error product-label-status" role="alert">
          <p>تعذر فتح نافذة الملصق.</p>
          <button type="button" className="secondary" onClick={() => void open()}>إعادة المحاولة</button>
        </div>
      ) : null}
      {openProduct && Dialog ? <Dialog product={openProduct} onClose={close} /> : null}
    </>
  );
}
