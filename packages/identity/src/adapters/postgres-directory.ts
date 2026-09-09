import type { BranchCode, StaffRole } from "@bravos/contracts";
import type { Pool } from "pg";
import type { AuthenticatedStaff, StaffChange, StaffGrant } from "../domain/authorization.ts";
import { DuplicateLoginNameError } from "../domain/login-name.ts";
import type { BranchRecord, StaffDirectory } from "../application/ports.ts";

type Queryable = Pick<Pool, "query">;

type StaffRow = {
  staff_id: string;
  display_name_ar: string;
  is_owner: boolean;
  username: string | null;
  name: string;
  role: string | null;
  banned: boolean | null;
};

type GrantRow = {
  staff_id: string;
  branch_id: string;
  cashier: boolean;
  order_representative: boolean;
  code: BranchCode;
};

type OperationRow = {
  operation: StaffChange["operation"];
  actor_staff_id: string | null;
  occurred_at: Date;
};

export function createPostgresStaffDirectory(pool: Pool): StaffDirectory {
  return {
    async listBranches() {
      const result = await pool.query<BranchRecord>(
        `SELECT id, code, name_ar AS "nameAr" FROM branch ORDER BY code`,
      );
      return result.rows;
    },

    async findByLoginName(loginName) {
      const result = await pool.query<StaffRow>(staffSelect(`u.username = $1`), [loginName]);
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return hydrateStaff(pool, row);
    },

    async getStaff(staffId) {
      const result = await pool.query<StaffRow>(staffSelect(`u.id = $1`), [staffId]);
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return hydrateStaff(pool, row);
    },

    async listStaff() {
      const result = await pool.query<StaffRow>(
        `${staffSelect("TRUE")} ORDER BY p.display_name_ar`,
      );
      const staff: AuthenticatedStaff[] = [];
      for (const row of result.rows) {
        staff.push(await hydrateStaff(pool, row));
      }
      return staff;
    },

    async replaceGrants(staffId, grants, actorStaffId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await lockStaff(client, staffId);
        await replaceGrantsOn(client, staffId, grants);
        await insertOperation(client, staffId, actorStaffId, "replace_grants");
        await clearUnauthorizedSessionBranchesOn(
          client,
          staffId,
          grants.map((grant) => grant.branchId),
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async resetPasswordAtomically(staffId, passwordHash, actorStaffId) {
      const client = await pool.connect();
      const timestamp = new Date();
      try {
        await client.query("BEGIN");
        await lockStaff(client, staffId);
        await client.query(
          `UPDATE account
           SET password = $2, "updatedAt" = $3
           WHERE "userId" = $1 AND "providerId" = 'credential'`,
          [staffId, passwordHash, timestamp],
        );
        await client.query(`DELETE FROM session WHERE "userId" = $1`, [staffId]);
        await insertOperation(client, staffId, actorStaffId, "reset_password");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async disableAtomically(staffId, actorStaffId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await lockStaff(client, staffId);
        await client.query(
          `UPDATE "user" SET banned = TRUE, "banReason" = 'disabled-by-manager' WHERE id = $1`,
          [staffId],
        );
        await client.query(`DELETE FROM session WHERE "userId" = $1`, [staffId]);
        await insertOperation(client, staffId, actorStaffId, "disable");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async getSessionBranch(sessionId) {
      const result = await pool.query<{ branch_id: string }>(
        `SELECT branch_id FROM staff_session_branch WHERE session_id = $1`,
        [sessionId],
      );
      return result.rows[0]?.branch_id ?? null;
    },

    async setSessionBranch(sessionId, staffId, branchId) {
      if (!branchId) {
        await pool.query("DELETE FROM staff_session_branch WHERE session_id = $1", [sessionId]);
        return;
      }
      await pool.query(
        `INSERT INTO staff_session_branch (session_id, staff_id, branch_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id)
         DO UPDATE SET branch_id = EXCLUDED.branch_id, staff_id = EXCLUDED.staff_id, updated_at = now()`,
        [sessionId, staffId, branchId],
      );
    },

    async saveRecoveryChallenge(input) {
      await pool.query(
        `INSERT INTO owner_recovery_challenge (id, staff_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [crypto.randomUUID(), input.staffId, input.tokenHash, input.expiresAt],
      );
    },

    async completeRecoveryAtomically(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query<{ staff_id: string }>(
          `SELECT staff_id
           FROM owner_recovery_challenge
           WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > $2
           LIMIT 1`,
          [input.tokenHash, input.now],
        );
        const ownerId = found.rows[0]?.staff_id;
        if (!ownerId) {
          await client.query("ROLLBACK");
          return null;
        }
        await lockStaff(client, ownerId);
        const stillValid = await client.query<{ id: string }>(
          `SELECT id
           FROM owner_recovery_challenge
           WHERE token_hash = $1 AND staff_id = $2 AND consumed_at IS NULL AND expires_at > $3
           LIMIT 1`,
          [input.tokenHash, ownerId, input.now],
        );
        if (!stillValid.rows[0]) {
          await client.query("ROLLBACK");
          return null;
        }
        await client.query(
          `UPDATE owner_recovery_challenge
           SET consumed_at = $2
           WHERE staff_id = $1 AND consumed_at IS NULL`,
          [ownerId, input.now],
        );
        await client.query(
          `UPDATE account
           SET password = $2, "updatedAt" = $3
           WHERE "userId" = $1 AND "providerId" = 'credential'`,
          [ownerId, input.passwordHash, input.now],
        );
        await client.query(`DELETE FROM session WHERE "userId" = $1`, [ownerId]);
        await client.query("COMMIT");
        return { staffId: ownerId };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export async function provisionStaffGraph(
  pool: Pool,
  input: {
    staffId: string;
    loginName: string;
    displayName: string;
    internalEmail: string;
    role: StaffRole;
    passwordHash: string;
    isOwner: boolean;
    grants: StaffGrant[];
    actorStaffId: string | null;
  },
): Promise<void> {
  const client = await pool.connect();
  const timestamp = new Date();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO "user" (
         id, name, email, "emailVerified", "createdAt", "updatedAt",
         username, "displayUsername", role, banned
       ) VALUES ($1, $2, $3, TRUE, $4, $4, $5, $5, $6, FALSE)`,
      [
        input.staffId,
        input.displayName,
        input.internalEmail,
        timestamp,
        input.loginName,
        input.role === "manager" ? "manager" : "staff",
      ],
    );
    await client.query(
      `INSERT INTO account (
         id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt"
       ) VALUES ($1, $2, 'credential', $3, $4, $5, $5)`,
      [crypto.randomUUID(), input.staffId, input.staffId, input.passwordHash, timestamp],
    );
    await client.query(
      `INSERT INTO staff_profile (
         staff_id, display_name_ar, is_owner, created_by_staff_id, last_changed_by_staff_id, last_changed_at
       ) VALUES ($1, $2, $3, $4, $4, $5)`,
      [input.staffId, input.displayName, input.isOwner, input.actorStaffId, timestamp],
    );
    await replaceGrantsOn(client, input.staffId, input.grants);
    await insertOperation(client, input.staffId, input.actorStaffId, "provision");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) {
      throw new DuplicateLoginNameError();
    }
    throw error;
  } finally {
    client.release();
  }
}

function staffSelect(where: string): string {
  return `SELECT u.id AS staff_id, p.display_name_ar, p.is_owner, u.username, u.name, u.role, u.banned
          FROM "user" u
          JOIN staff_profile p ON p.staff_id = u.id
          WHERE ${where}`;
}

async function hydrateStaff(pool: Queryable, row: StaffRow): Promise<AuthenticatedStaff> {
  const grants = await pool.query<GrantRow>(
    `SELECT g.staff_id, g.branch_id, g.cashier, g.order_representative, b.code
     FROM staff_branch_grant g
     JOIN branch b ON b.id = g.branch_id
     WHERE g.staff_id = $1
     ORDER BY b.code`,
    [row.staff_id],
  );
  const operations = await pool.query<OperationRow>(
    `SELECT operation, actor_staff_id, occurred_at
     FROM staff_operation
     WHERE staff_id = $1
     ORDER BY occurred_at ASC, id ASC`,
    [row.staff_id],
  );
  const changes: StaffChange[] = operations.rows.map((item) => ({
    operation: item.operation,
    actorStaffId: item.actor_staff_id,
    occurredAt: item.occurred_at,
  }));
  const latest = changes.at(-1);
  const mappedGrants: StaffGrant[] = grants.rows.map((grant) => ({
    branchId: grant.branch_id,
    branchCode: grant.code,
    cashier: grant.cashier,
    orderRepresentative: grant.order_representative,
  }));
  const role: StaffRole = row.role === "manager" ? "manager" : "employee";
  return {
    id: row.staff_id,
    loginName: row.username ?? "",
    displayName: row.display_name_ar,
    role,
    disabled: Boolean(row.banned),
    isOwner: row.is_owner,
    grants: mappedGrants,
    changedByStaffId: latest?.actorStaffId ?? null,
    changedAt: latest?.occurredAt ?? new Date(0),
    changes,
  };
}

async function lockStaff(client: Queryable, staffId: string) {
  const locked = await client.query(
    `SELECT staff_id FROM staff_profile WHERE staff_id = $1 FOR UPDATE`,
    [staffId],
  );
  if (!locked.rows[0]) {
    throw new Error("Staff profile is missing.");
  }
}

async function replaceGrantsOn(client: Queryable, staffId: string, grants: StaffGrant[]) {
  await client.query("DELETE FROM staff_branch_grant WHERE staff_id = $1", [staffId]);
  for (const grant of grants) {
    await client.query(
      `INSERT INTO staff_branch_grant (staff_id, branch_id, cashier, order_representative)
       VALUES ($1, $2, $3, $4)`,
      [staffId, grant.branchId, grant.cashier, grant.orderRepresentative],
    );
  }
}

async function insertOperation(
  client: Queryable,
  staffId: string,
  actorStaffId: string | null,
  operation: StaffChange["operation"],
) {
  await client.query(
    `INSERT INTO staff_operation (id, staff_id, actor_staff_id, operation)
     VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), staffId, actorStaffId, operation],
  );
  await client.query(
    `UPDATE staff_profile
     SET last_changed_by_staff_id = $2, last_changed_at = now()
     WHERE staff_id = $1`,
    [staffId, actorStaffId],
  );
}

async function clearUnauthorizedSessionBranchesOn(
  client: Queryable,
  staffId: string,
  allowedBranchIds: string[],
) {
  if (allowedBranchIds.length === 0) {
    await client.query("DELETE FROM staff_session_branch WHERE staff_id = $1", [staffId]);
    return;
  }
  await client.query(
    `DELETE FROM staff_session_branch
     WHERE staff_id = $1 AND NOT (branch_id = ANY($2::uuid[]))`,
    [staffId, allowedBranchIds],
  );
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "23505",
  );
}
