import {
  DEFAULT_STAFF_ORIGIN,
  PRINT_CONNECTOR_HOST,
  PRINT_CONNECTOR_PORT,
  assertStaffOrigin,
} from "./contracts.ts";

export function readStaffOrigin(value: string | undefined): string {
  if (value === undefined || value === "") return DEFAULT_STAFF_ORIGIN;
  return assertStaffOrigin(value);
}

export function assertWindowsConnectorPlatform(platform: string): void {
  if (platform !== "win32") throw new Error("unsupported_platform");
}

export function productionListenTarget(): { host: typeof PRINT_CONNECTOR_HOST; port: typeof PRINT_CONNECTOR_PORT } {
  return { host: PRINT_CONNECTOR_HOST, port: PRINT_CONNECTOR_PORT };
}

export function assertListenTarget(host: string, port: number, mode: "production" | "ephemeral-test"): void {
  if (host !== PRINT_CONNECTOR_HOST) throw new Error("refusing_listen_host");
  if (mode === "production") {
    if (port !== PRINT_CONNECTOR_PORT) throw new Error("refusing_listen_port");
    return;
  }
  if (port !== 0) throw new Error("refusing_listen_port");
}
