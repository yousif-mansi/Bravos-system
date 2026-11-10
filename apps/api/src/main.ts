import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { loadLocalEnv } from "./load-env.ts";

if (process.env.NODE_ENV !== "production" && process.env.BRAVOS_LOAD_LOCAL_ENV !== "false") {
  await loadLocalEnv();
}
const config = loadConfig();
const port = Number(process.env.PORT ?? 3010);
// The container may bind its private bridge interface; the host must still keep
// this port unpublished so only the reverse proxy can reach it.
const host = process.env.BRAVOS_LISTEN_HOST ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "0.0.0.0") {
  throw new Error("BRAVOS_LISTEN_HOST must be 127.0.0.1 or 0.0.0.0.");
}
const built = await buildApp(config);
await built.app.listen({ port, host });
console.log(`BRAVOS API listening on http://${host}:${port}`);

let closing: Promise<void> | undefined;
function close(signal: NodeJS.Signals) {
  if (!closing) {
    console.log(`BRAVOS API received ${signal}; closing.`);
    closing = built.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
  return closing;
}

process.once("SIGINT", () => void close("SIGINT"));
process.once("SIGTERM", () => void close("SIGTERM"));
process.on("message", (message) => {
  if (message !== "bravos-supervisor-shutdown") return;
  void close("SIGTERM").finally(() => {
    if (process.connected) process.disconnect();
  });
});
if (process.connected) {
  process.once("disconnect", () => void close("SIGTERM"));
}
