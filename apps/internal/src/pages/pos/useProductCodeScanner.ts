import { type FormEvent, type KeyboardEvent, useRef } from "react";

/** Align with server catalog lookup: trimmed NFC, case-insensitive. */
export function productCodeKey(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

export function productCodesEqual(stored: string, entered: string): boolean {
  return productCodeKey(stored) === productCodeKey(entered);
}

export function findCachedProductByCode<T extends { code: string }>(products: T[], code: string): T | undefined {
  return products.find((item) => productCodesEqual(item.code, code));
}

export function isolateScanSubmit(event: FormEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export function focusManualSizeChoice(sizeSelect: HTMLSelectElement | null): void {
  window.requestAnimationFrame(() => {
    const pair = sizeSelect?.closest("section")?.querySelector<HTMLButtonElement>(".pos-pairs button");
    if (pair) {
      pair.focus({ preventScroll: true });
      pair.scrollIntoView({ block: "nearest", behavior: "instant" });
      return;
    }
    sizeSelect?.focus({ preventScroll: true });
  });
}

export function useProductCodeScanner() {
  const scanInputRef = useRef<HTMLInputElement>(null);

  function onScanKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.stopPropagation();
    }
  }

  function focusScanInput(): void {
    scanInputRef.current?.focus({ preventScroll: true });
  }

  return { scanInputRef, onScanKeyDown, focusScanInput };
}
