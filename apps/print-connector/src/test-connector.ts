import { DEFAULT_STAFF_ORIGIN, JOB_METADATA_CAP, JOB_RETENTION_MS, QUEUE_CAP } from "./contracts.ts";
import { createMemoryJobJournal } from "./adapters/memory-job-journal.ts";
import { createMemoryTokenStore, type MemoryTokenStore } from "./adapters/memory-token-store.ts";
import type { JobJournal, LocalNotice, PrintPort, SanitizedEvent, TokenStore } from "./ports.ts";
import { listenPrintConnector } from "./server.ts";
import { createConnectorService, defaultRandomBytes, type ConnectorService } from "./service.ts";

export type TestConnector = {
  port: number;
  host: "127.0.0.1";
  staffOrigin: string;
  logs: SanitizedEvent[];
  notices: LocalNotice[];
  tokenStore: TokenStore;
  service: ConnectorService;
  close: () => Promise<void>;
  waitUntilIdle: () => Promise<void>;
  holdsDocument: (id: string) => boolean;
};

export async function createPrintConnectorForTests(options: {
  printPort: PrintPort;
  tokenStore?: MemoryTokenStore;
  journal?: JobJournal;
  staffOrigin?: string;
  now?: () => number;
  queueCap?: number;
  metadataCap?: number;
  retentionMs?: number;
}): Promise<TestConnector> {
  const logs: SanitizedEvent[] = [];
  const notices: LocalNotice[] = [];
  const staffOrigin = options.staffOrigin ?? DEFAULT_STAFF_ORIGIN;
  const tokenStore = options.tokenStore ?? createMemoryTokenStore();
  const service = await createConnectorService({
    printPort: options.printPort,
    tokenStore,
    journal: options.journal ?? createMemoryJobJournal(),
    staffOrigin,
    now: options.now ?? Date.now,
    randomBytes: defaultRandomBytes,
    localNotice(notice) {
      notices.push(notice);
    },
    log(event) {
      logs.push(event);
    },
    queueCap: options.queueCap ?? QUEUE_CAP,
    metadataCap: options.metadataCap ?? JOB_METADATA_CAP,
    retentionMs: options.retentionMs ?? JOB_RETENTION_MS,
  });
  const running = await listenPrintConnector({
    service,
    staffOrigin,
    port: 0,
    mode: "ephemeral-test",
    log(event) {
      logs.push(event);
    },
  });
  return {
    port: running.port,
    host: running.host,
    staffOrigin,
    logs,
    notices,
    tokenStore,
    service,
    close: () => running.close(),
    waitUntilIdle: () => running.waitUntilIdle(),
    holdsDocument: (id) => running.holdsDocument(id),
  };
}
