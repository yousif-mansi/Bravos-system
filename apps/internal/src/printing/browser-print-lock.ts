/**
 * One browser print dialog at a time for receipts and product labels.
 * The token is an ownership proof: only the claimer can release the lock.
 */
let holder: symbol | null = null;

export class BrowserPrintBusyError extends Error {
  constructor() {
    super("نافذة طباعة مفتوحة.");
    this.name = "BrowserPrintBusyError";
  }
}

export function claimBrowserPrint(): symbol {
  if (holder) throw new BrowserPrintBusyError();
  const token = Symbol("bravos-browser-print");
  holder = token;
  return token;
}

export function releaseBrowserPrint(token: symbol): void {
  if (holder === token) holder = null;
}
