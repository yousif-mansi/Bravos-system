import { startPostgresCluster } from "@bravos/testkit";

const cluster = await startPostgresCluster({
  port: Number(process.env.BRAVOS_PG_PORT ?? 54329),
  persistentDir: process.env.BRAVOS_PG_DATA_DIR ?? ".local/postgres",
});
console.log(`Local PostgreSQL listening on 127.0.0.1:${cluster.port}`);
await new Promise<void>((resolve) => {
  process.on("SIGINT", () => resolve());
  process.on("SIGTERM", () => resolve());
});
await cluster.stop();
