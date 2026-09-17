import type { RestorePauseDto } from "@bravos/contracts";
import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
};

type RuntimeRow = { current_generation: string; paused_preview_id: string | null; paused_at: Date | null };

// Other features read the restore generation through this reader at composition.
export function createPostgresRestoreRuntimeReader(queryable: Queryable) {
  return {
    // Holds the shared restore lock for the caller's transaction, so activation cannot change the
    // generation until that transaction ends.
    async current(): Promise<{ generation: number; pause: RestorePauseDto | null }> {
      await queryable.query("SELECT pg_advisory_xact_lock_shared(1112687187, 27)");
      const row = await readRuntime(queryable);
      return {
        generation: Number(row.current_generation),
        pause: row.paused_preview_id && row.paused_at
          ? { previewId: row.paused_preview_id, generation: Number(row.current_generation), pausedAt: row.paused_at.toISOString() }
          : null,
      };
    },
    // Used inside the read-only backup snapshot.
    async readRestoreGeneration(): Promise<number> {
      return Number((await readRuntime(queryable)).current_generation);
    },
  };
}

async function readRuntime(queryable: Queryable): Promise<RuntimeRow> {
  const result = await queryable.query<RuntimeRow>(
    "SELECT current_generation::text, paused_preview_id, paused_at FROM restore_runtime WHERE singleton = TRUE",
  );
  const row = result.rows[0];
  if (!row) throw new Error("Restore runtime state is missing.");
  return row;
}
