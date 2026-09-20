import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { loadLocalEnv } from "./load-env.ts";

if (process.env.NODE_ENV !== "production" && process.env.BRAVOS_LOAD_LOCAL_ENV !== "false") {
  await loadLocalEnv();
}
const config = loadConfig();
const built = await buildApp(config);
const port = Number(process.env.PORT ?? 3010);
await built.app.listen({ port, host: "127.0.0.1" });
console.log(`BRAVOS API listening on http://127.0.0.1:${port}`);

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
