import type { PoolClient } from "pg";
import type { OpeningOnlineOrderTransaction } from "../application/ports.ts";

export function createPostgresOpeningOnlineOrderTransaction(client: PoolClient): OpeningOnlineOrderTransaction {
  return {
    async inspectOpeningConfiguration(areas) {
      const [areaRows, settings] = await Promise.all([
        client.query<{ id: string; name_ar: string; fee_piasters: number | string; active: boolean }>("SELECT id,name_ar,fee_piasters,active FROM delivery_area ORDER BY id"),
        client.query<{ unreachable_wait_hours: number; minimum_contact_attempts: number }>("SELECT unreachable_wait_hours,minimum_contact_attempts FROM online_order_settings WHERE singleton=TRUE"),
      ]);
      const existing = new Set(areaRows.rows.map((row) => normalize(row.name_ar)));
      const current = settings.rows[0] ?? { unreachable_wait_hours: 48, minimum_contact_attempts: 2 };
      return {
        state: { areas: areaRows.rows, settings: current },
        settings: { unreachableWaitHours: current.unreachable_wait_hours, minimumContactAttempts: current.minimum_contact_attempts },
        errors: areas.filter((row) => existing.has(normalize(row.nameAr))).map((row) => ({ file: "configuration.csv" as const, line: row.line, column: "name_ar", code: "COLLISION", messageAr: "منطقة التوصيل موجودة بالفعل." })),
      };
    },
    async insertOpeningConfiguration(input) {
      for (const area of input.areas) await client.query(`INSERT INTO delivery_area (id,name_ar,fee_piasters,active,changed_by_staff_id,changed_at) VALUES ($1,$2,$3,$4,$5,$6)`,[area.id,area.nameAr,area.feePiasters,area.active,input.actorStaffId,input.at]);
      if (input.settings) await client.query(`UPDATE online_order_settings SET revision=revision+1,unreachable_wait_hours=$1,minimum_contact_attempts=$2,changed_by_staff_id=$3,changed_at=$4 WHERE singleton=TRUE`,[input.settings.unreachableWaitHours,input.settings.minimumContactAttempts,input.actorStaffId,input.at]);
    },
  };
}
function normalize(value: string) { return value.trim().toLocaleLowerCase("ar-EG"); }
