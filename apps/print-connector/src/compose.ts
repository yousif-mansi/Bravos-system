import { createWindowsDpapiTokenStore } from "./adapters/windows-dpapi-token-store.ts";
import { createWindowsJobJournal } from "./adapters/windows-job-journal.ts";
import { createWindowsPrintPort } from "./adapters/windows-print-port.ts";
import { emitSanitized } from "./adapters/sanitized-log.ts";
import { JOB_METADATA_CAP, JOB_RETENTION_MS, QUEUE_CAP } from "./contracts.ts";
import { isPairingCode } from "./domain/pairing.ts";
import { assertListenTarget, assertWindowsConnectorPlatform, productionListenTarget, readStaffOrigin } from "./listen.ts";
import type { LocalNotice } from "./ports.ts";
import { listenPrintConnector } from "./server.ts";
import { createConnectorService, defaultRandomBytes } from "./service.ts";

export function formatLocalNotice(notice: LocalNotice): string | null {
  if (notice.type !== "pairing_code" || !isPairingCode(notice.code)) return null;
  return `Bravos print connector pairing code: ${notice.code}\n`;
}

/** Manual Windows start. Binds 127.0.0.1:17831 and does not register a service or firewall rule. */
export async function startWindowsPrintConnector(): Promise<void> {
  assertWindowsConnectorPlatform(process.platform);
  const target = productionListenTarget();
  assertListenTarget(target.host, target.port, "production");
  const staffOrigin = readStaffOrigin(process.env.BRAVOS_PRINT_STAFF_ORIGIN);
  const { submitNativePrint } = await import("./renderers/api.ts");
  const service = await createConnectorService({
    printPort: createWindowsPrintPort({ submitter: submitNativePrint }),
    tokenStore: createWindowsDpapiTokenStore(),
    journal: createWindowsJobJournal(),
    staffOrigin,
    now: Date.now,
    randomBytes: defaultRandomBytes,
    localNotice(notice) {
      const line = formatLocalNotice(notice);
      if (line) process.stdout.write(line);
    },
    log: emitSanitized,
    queueCap: QUEUE_CAP,
    metadataCap: JOB_METADATA_CAP,
    retentionMs: JOB_RETENTION_MS,
  });
  await listenPrintConnector({
    service,
    staffOrigin,
    port: target.port,
    mode: "production",
    log: emitSanitized,
  });
}
