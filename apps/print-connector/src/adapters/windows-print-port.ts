import {
  LABEL_COPIES_MAX,
  LABEL_COPIES_MIN,
  LABEL_PRINTER_NAME,
  RECEIPT_COPIES,
  RECEIPT_PRINTER_NAME,
} from "../contracts.ts";
import { failureFromProbe, normalizePortResult, type DriverProbeState } from "../domain/print-result.ts";
import type { PrintDispatch, PrintPort } from "../ports.ts";
import { UNAVAILABLE_RENDERER } from "./unavailable-renderer.ts";

export type DriverProbe = (printerName: string) => Promise<DriverProbeState>;

/** Trusted callback. Production injects submitNativePrint; tests inject a fake. */
export type PrintSubmitter = (dispatch: PrintDispatch) => Promise<unknown>;

function isRoutable(dispatch: PrintDispatch): boolean {
  if (dispatch.document.kind !== dispatch.kind) return false;
  if (dispatch.kind === "label") {
    return dispatch.printerName === LABEL_PRINTER_NAME
      && Number.isInteger(dispatch.copies)
      && dispatch.copies >= LABEL_COPIES_MIN
      && dispatch.copies <= LABEL_COPIES_MAX
      && dispatch.document.copies === dispatch.copies;
  }
  return dispatch.printerName === RECEIPT_PRINTER_NAME
    && dispatch.copies === RECEIPT_COPIES
    && dispatch.document.copies === RECEIPT_COPIES;
}

/**
 * Windows spooler adapter. Platform and the kind/printer/copies allowlist run
 * before any probe or submitter. With no submitter the port stays fail-closed
 * and does not spawn a helper. Production injects the native submitter and
 * omits a second probe, because that submitter already probes the live queue.
 */
export function createWindowsPrintPort(options: {
  platform?: string;
  probe?: DriverProbe;
  submitter?: PrintSubmitter;
} = {}): PrintPort {
  const platform = options.platform ?? process.platform;
  const probe = options.probe;
  const submitter = options.submitter;
  return {
    describe() {
      return { implementation: submitter ? "windows_native" : "windows_fail_closed" };
    },
    async submit(dispatch) {
      if (platform !== "win32") {
        return { outcome: "failed", code: "unsupported_platform" };
      }
      if (!isRoutable(dispatch)) {
        return { outcome: "failed", code: "unsupported_driver" };
      }
      if (probe) {
        try {
          const state = await probe(dispatch.printerName);
          const mapped = failureFromProbe(state);
          if (mapped !== "ready") return mapped;
        } catch {
          return { outcome: "failed", code: "unsupported_driver" };
        }
      }
      if (!submitter) {
        const rendered: { ok: boolean; reason?: string } = UNAVAILABLE_RENDERER.render();
        if (rendered.ok !== false) {
          return { outcome: "failed", code: "renderer_unavailable" };
        }
        return { outcome: "failed", code: "renderer_unavailable" };
      }
      try {
        return normalizePortResult(await submitter(dispatch));
      } catch {
        return { outcome: "unknown" };
      }
    },
  };
}
