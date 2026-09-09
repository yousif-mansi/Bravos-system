import { applyMigrations } from "@bravos/persistence";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { loadLocalEnv } from "./load-env.ts";

await loadLocalEnv();
const config = loadConfig();
const built = await buildApp(config);
await applyMigrations(built.pool);
const port = Number(process.env.PORT ?? 3010);
await built.app.listen({ port, host: "127.0.0.1" });
console.log(`BRAVOS API listening on http://127.0.0.1:${port}`);
