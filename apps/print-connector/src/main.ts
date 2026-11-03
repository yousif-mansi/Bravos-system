import { startWindowsPrintConnector } from "./compose.ts";
import { createWindowsDpapiTokenStore } from "./adapters/windows-dpapi-token-store.ts";
import {
  defaultLoopbackOccupancy,
  dispatchConnectorCommand,
  resetLocalPairing,
  resetRefusalMessage,
} from "./local-reset.ts";

dispatchConnectorCommand(process.argv.slice(2), {
  start: startWindowsPrintConnector,
  reset: async () => {
    await resetLocalPairing({
      occupancy: () => defaultLoopbackOccupancy(),
      clearPairing: () => createWindowsDpapiTokenStore().clear(),
    });
    process.stdout.write("pairing reset\n");
  },
}).catch((error: unknown) => {
  if (error instanceof Error && error.message === "connector_still_running") {
    process.stderr.write(resetRefusalMessage());
    process.exitCode = 1;
    return;
  }
  const message = error instanceof Error && error.message ? error.message : "start_failed";
  process.stderr.write(`print connector failed: ${message}\n`);
  process.exitCode = 1;
});
