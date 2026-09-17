import type { QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
};

const TABLE_NAMES = [
  "identity_actor",
  "branch",
  "staff_profile",
  "staff_branch_grant",
  "staff_operation",
] as const;

type RestoreTableName = (typeof TABLE_NAMES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTOR_COLUMNS = ["created_at", "disable_expires_at", "disable_reason", "disabled", "display_username", "id", "role", "updated_at", "username"];

export function createPostgresIdentityRestorePort(queryable: Queryable) {
  return {
    tableNames: TABLE_NAMES,
    async clearRestoreTable(tableName: string): Promise<void> {
      const table = restoreTable(tableName);
      if (table === "identity_actor") {
        // Activation revokes every session and pending verification. Login identities are
        // reconciled when the archived actors are loaded, so surviving credentials stay usable.
        await queryable.query(`DELETE FROM "session"`);
        await queryable.query(`DELETE FROM "verification"`);
        return;
      }
      await queryable.query(`DELETE FROM ${table}`);
    },
    async insertRestoreTable(tableName: string, rows: Array<Record<string, unknown>>): Promise<number> {
      const table = restoreTable(tableName);
      if (table === "identity_actor") {
        await loadActors(queryable, rows);
        return rows.length;
      }
      if (table === "staff_profile") {
        // Profiles may name a creator that appears later in the archive.
        await insertRestoreRows(queryable, table, rows.map((row) => ({ ...row, created_by_staff_id: null, last_changed_by_staff_id: null })));
        for (const row of rows) {
          await queryable.query(
            "UPDATE staff_profile SET created_by_staff_id = $2, last_changed_by_staff_id = $3 WHERE staff_id = $1",
            [row.staff_id, row.created_by_staff_id, row.last_changed_by_staff_id],
          );
        }
        await assertSingleEnabledOwner(queryable);
        return rows.length;
      }
      await insertRestoreRows(queryable, table, rows);
      return rows.length;
    },
  };
}

// Archived actors carry no credentials. Actors that already exist keep their credential rows;
// actors missing from the archive are removed together with their credentials.
async function loadActors(queryable: Queryable, rows: Array<Record<string, unknown>>) {
  for (const actor of rows) {
    const keys = Object.keys(actor).sort();
    if (keys.length !== ACTOR_COLUMNS.length || keys.some((key, index) => key !== ACTOR_COLUMNS[index])
      || typeof actor.id !== "string" || !UUID_PATTERN.test(actor.id)
      || typeof actor.username !== "string" || actor.username.length === 0
      || !(actor.display_username === null || typeof actor.display_username === "string")
      || (actor.role !== "manager" && actor.role !== "employee") || typeof actor.disabled !== "boolean") {
      throw restoreDataError("Invalid identity actor restore row.");
    }
  }
  const ids = rows.map((actor) => actor.id as string);
  await queryable.query(`DELETE FROM "user" WHERE NOT (id = ANY($1::text[]))`, [ids]);
  // Free login names first so archived names can move between surviving identities.
  await queryable.query(`UPDATE "user" SET username = id`);
  for (const actor of rows) {
    const displayName = typeof actor.display_username === "string" && actor.display_username.length > 0
      ? actor.display_username
      : actor.username;
    await queryable.query(
      `INSERT INTO "user" (
         id, name, email, "emailVerified", image, "createdAt", "updatedAt",
         username, "displayUsername", role, banned, "banReason", "banExpires"
       ) VALUES ($1, $2, $3, TRUE, NULL, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt",
         username = EXCLUDED.username, "displayUsername" = EXCLUDED."displayUsername",
         role = EXCLUDED.role, banned = EXCLUDED.banned, "banReason" = EXCLUDED."banReason",
         "banExpires" = EXCLUDED."banExpires"`,
      [
        actor.id,
        displayName,
        `${actor.id}@restored.bravos.invalid`,
        actor.created_at,
        actor.updated_at,
        actor.username,
        actor.display_username,
        actor.role === "manager" ? "manager" : "staff",
        actor.disabled,
        actor.disable_reason,
        actor.disable_expires_at,
      ],
    );
  }
}

async function assertSingleEnabledOwner(queryable: Queryable): Promise<void> {
  const result = await queryable.query<{ owner_count: number }>(
    `SELECT COUNT(*)::int AS owner_count
     FROM staff_profile profile
     JOIN "user" actor ON actor.id = profile.staff_id
     WHERE profile.is_owner AND actor.role = 'manager' AND NOT COALESCE(actor.banned, FALSE)`,
  );
  if (result.rows[0]?.owner_count !== 1) {
    throw restoreDataError("Restored identity data must contain exactly one enabled manager owner.");
  }
}

function restoreTable(tableName: string): RestoreTableName {
  const table = TABLE_NAMES.find((name) => name === tableName);
  if (!table) throw restoreDataError(`Unapproved identity restore table: ${tableName}`);
  return table;
}

// Rows are loaded through jsonb_populate_recordset so PostgreSQL converts each value with the
// column's own type, including arrays, JSON documents, big integers and timestamp text.
async function insertRestoreRows(queryable: Queryable, table: RestoreTableName, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;
  const columns = await queryable.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
    [table],
  );
  const expected = columns.rows.map((row) => row.column_name).sort();
  for (const row of rows) {
    const keys = Object.keys(row).sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      throw restoreDataError(`Restore row for ${table} does not match the table columns.`);
    }
  }
  for (let offset = 0; offset < rows.length; offset += 500) {
    await queryable.query(
      `INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`,
      [JSON.stringify(rows.slice(offset, offset + 500))],
    );
  }
}

// Marks archive or staged data that cannot be loaded, as opposed to a server fault.
function restoreDataError(message: string) {
  return Object.assign(new Error(message), { code: "RESTORE_DATA_INVALID" });
}
