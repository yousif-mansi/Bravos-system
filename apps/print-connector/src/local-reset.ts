import net from "node:net";
import { createWindowsDpapiTokenStore } from "./adapters/windows-dpapi-token-store.ts";
import { PRINT_CONNECTOR_HOST, PRINT_CONNECTOR_PORT } from "./contracts.ts";

export type ConnectorCommand = "start" | "reset-pairing";

/** Empty argv starts the connector. Only `--reset-pairing` is the other command. */
export function parseConnectorArgs(argv: readonly string[]): ConnectorCommand {
  if (argv.length === 0) return "start";
  if (argv.length === 1 && argv[0] === "--reset-pairing") return "reset-pairing";
  throw new Error("unknown_arguments");
}

export type PortOccupancy = "owned" | "free";

export function resetRefusalMessage(): string {
  return `print connector is still running on ${PRINT_CONNECTOR_HOST}:${PRINT_CONNECTOR_PORT}; stop the program first\n`;
}

/** Read-only loopback check. A successful connect means the port is owned. */
export function defaultLoopbackOccupancy(
  host: string = PRINT_CONNECTOR_HOST,
  port: number = PRINT_CONNECTOR_PORT,
): Promise<PortOccupancy> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (result: PortOccupancy | Error) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => finish("owned"));
    socket.once("timeout", () => finish("owned"));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED") finish("free");
      else finish(error);
    });
  });
}

export async function resetLocalPairing(deps: {
  platform?: string;
  occupancy: () => Promise<PortOccupancy>;
  clearPairing?: () => Promise<void>;
}): Promise<void> {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") throw new Error("unsupported_platform");
  const occupancy = await deps.occupancy();
  if (occupancy !== "free") throw new Error("connector_still_running");
  const clear = deps.clearPairing ?? (() => createWindowsDpapiTokenStore().clear());
  await clear();
}

export async function dispatchConnectorCommand(
  argv: readonly string[],
  effects: {
    start: () => Promise<void>;
    reset: () => Promise<void>;
  },
): Promise<void> {
  const command = parseConnectorArgs(argv);
  if (command === "reset-pairing") {
    await effects.reset();
    return;
  }
  await effects.start();
}
