import { LABEL_PRINTER_NAME, RECEIPT_PRINTER_NAME } from "../contracts.ts";

/** Keep the allow-list in sync with Gate in helpers/native-print.cs. */
export const LABEL_DRIVER_NAME = "Xprinter XP-236B";
export const RECEIPT_DRIVER_NAME = "Xprinter XP-80";
const RECEIPT_DRIVER_80C = "XP-80C";

const READY_STATUS = new Set([
  "normal",
  "0",
  "busy",
  "printing",
  "ioactive",
  "processing",
  "waiting",
  "warmingup",
  "initializing",
  "powersave",
]);

export type ObservedDevice = {
  id: string;
  status: string;
};

export type ObservedQueue = {
  found: boolean;
  driverName: string;
  workOffline: boolean;
  portName: string;
  status: string;
  truncated: boolean;
  verifiedLabelDeviceId?: string;
  devices: ObservedDevice[];
};

export type ObservedPrinters = {
  label: ObservedQueue;
  receipt: ObservedQueue;
};

export type QueueState = "missing" | "offline" | "unsupported" | "ready";

export type QueueRole = "label" | "receipt";

function isUsbPort(port: string): boolean {
  return /^USB\d{3}$/.test(port);
}

function endsWithPort(id: string, port: string): boolean {
  const upper = id.toUpperCase();
  const token = port.toUpperCase();
  return upper.endsWith(`\\${token}`) || upper.endsWith(`&${token}`);
}

function deviceMatches(role: QueueRole, row: ObservedQueue, device: ObservedDevice): boolean {
  if (device.status.toUpperCase() !== "OK") return false;
  const id = device.id.toUpperCase();
  if (!id.startsWith("USBPRINT\\")) return false;
  const matchingPort = endsWithPort(id, row.portName);
  if (role === "label") {
    return id.startsWith("USBPRINT\\XPRINTERXP-236B\\")
      && (row.verifiedLabelDeviceId === undefined ? matchingPort : id === row.verifiedLabelDeviceId.toUpperCase());
  }
  if (!matchingPort) return false;
  if (id.includes("236B")) return false;
  return id.startsWith("USBPRINT\\PRINTERPOS-80\\")
    || id.includes("XPRINTERXP-80")
    || id.includes("XP-80")
    || id.includes("XP80");
}

export function judgeObservedQueue(role: QueueRole, row: ObservedQueue): QueueState {
  if (row.truncated) return "unsupported";
  if (!row.found) return "missing";
  const driverAllowed = role === "label"
    ? row.driverName === LABEL_DRIVER_NAME
    : row.driverName === RECEIPT_DRIVER_NAME || row.driverName === RECEIPT_DRIVER_80C;
  if (!driverAllowed) return "unsupported";
  if (!isUsbPort(row.portName)) return "unsupported";
  if (row.workOffline) return "offline";
  if (!READY_STATUS.has(row.status.trim().toLowerCase())) return "offline";
  const present = row.devices.some((device) => deviceMatches(role, row, device));
  if (!present) return "offline";
  return "ready";
}

export function expectedPrinterName(role: QueueRole): typeof LABEL_PRINTER_NAME | typeof RECEIPT_PRINTER_NAME {
  return role === "label" ? LABEL_PRINTER_NAME : RECEIPT_PRINTER_NAME;
}

export function failureCodeForState(state: QueueState): "printer_missing" | "printer_offline" | "unsupported_driver" | null {
  if (state === "ready") return null;
  if (state === "missing") return "printer_missing";
  if (state === "offline") return "printer_offline";
  return "unsupported_driver";
}
