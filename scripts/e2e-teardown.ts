import { readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import path from "node:path";

interface ControlFile {
  version: 1;
  port: number;
  token: string;
  apiPort: 3011;
  databasePort: 55433;
}

function assertPort(value: unknown, name: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 65_535) {
    throw new Error(`Invalid ${name} in the e2e control file.`);
  }
}

function parseControlFile(raw: string): ControlFile {
  const value = JSON.parse(raw) as Partial<ControlFile>;
  if (value.version !== 1 || value.apiPort !== 3011 || value.databasePort !== 55433) {
    throw new Error("Invalid e2e control file contract.");
  }
  assertPort(value.port, "control port");
  if (typeof value.token !== "string" || !/^[a-f0-9]{64}$/u.test(value.token)) {
    throw new Error("Invalid token in the e2e control file.");
  }
  return value as ControlFile;
}

async function portIsOpen(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function waitForPortsToClose(ports: number[]): Promise<void> {
  const deadline = Date.now() + 10_000;
  let openPorts: number[] = [];
  do {
    openPorts = [];
    for (const port of ports) {
      if (await portIsOpen(port)) {
        openPorts.push(port);
      }
    }
    if (openPorts.length === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`E2E shutdown left listeners open on: ${openPorts.join(", ")}`);
}

export default async function globalTeardown(): Promise<void> {
  const configuredControlFile = process.env.BRAVOS_E2E_CONTROL_FILE;
  if (!configuredControlFile) {
    throw new Error("BRAVOS_E2E_CONTROL_FILE is required for e2e teardown.");
  }
  const localDir = path.resolve(".local");
  const controlFile = path.resolve(configuredControlFile);
  if (path.dirname(controlFile) !== localDir) {
    throw new Error("The e2e control file must be a direct child of the workspace .local directory.");
  }

  const control = parseControlFile(await readFile(controlFile, "utf8"));
  const response = await fetch(`http://127.0.0.1:${control.port}/shutdown`, {
    method: "POST",
    headers: { authorization: `Bearer ${control.token}` },
    signal: AbortSignal.timeout(45_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`E2E graceful shutdown failed (${response.status}): ${body}`);
  }

  await waitForPortsToClose([control.apiPort, control.databasePort, control.port]);
  await rm(controlFile, { force: true });
}
