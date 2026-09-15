import type { PublicStorefrontContactsDto, StorefrontContactsDto } from "@bravos/contracts";
import type { Pool } from "pg";
import type { StorefrontContactsStore } from "../application/ports.ts";
import { safeStorefrontContactUrl } from "../domain/contact-url.ts";

type ContactsRow = {
  whatsapp_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  changed_by_staff_id: string | null;
  changed_at: Date | null;
};

export function createPostgresStorefrontContactsStore(pool: Pool): StorefrontContactsStore {
  return {
    async getPublic() {
      const row = await load(pool);
      return publicDto(row);
    },
    async getManager() {
      return managerDto(await load(pool));
    },
    async update(input) {
      const result = await pool.query<ContactsRow>(
        `INSERT INTO storefront_contacts (
           id, whatsapp_url, facebook_url, instagram_url, tiktok_url, changed_by_staff_id, changed_at
         ) VALUES ('default', $1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           whatsapp_url = EXCLUDED.whatsapp_url,
           facebook_url = EXCLUDED.facebook_url,
           instagram_url = EXCLUDED.instagram_url,
           tiktok_url = EXCLUDED.tiktok_url,
           changed_by_staff_id = EXCLUDED.changed_by_staff_id,
           changed_at = EXCLUDED.changed_at
         RETURNING whatsapp_url, facebook_url, instagram_url, tiktok_url, changed_by_staff_id, changed_at`,
        [input.whatsappUrl, input.facebookUrl, input.instagramUrl, input.tiktokUrl, input.actorStaffId, input.at],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Storefront contact configuration was not returned.");
      return managerDto(row);
    },
  };
}

async function load(pool: Pool): Promise<ContactsRow | null> {
  const result = await pool.query<ContactsRow>(
    `SELECT whatsapp_url, facebook_url, instagram_url, tiktok_url, changed_by_staff_id, changed_at
     FROM storefront_contacts WHERE id = 'default'`,
  );
  return result.rows[0] ?? null;
}

function publicDto(row: ContactsRow | null): PublicStorefrontContactsDto {
  return {
    whatsappUrl: safeStorefrontContactUrl("whatsapp", row?.whatsapp_url),
    facebookUrl: safeStorefrontContactUrl("facebook", row?.facebook_url),
    instagramUrl: safeStorefrontContactUrl("instagram", row?.instagram_url),
    tiktokUrl: safeStorefrontContactUrl("tiktok", row?.tiktok_url),
  };
}

function managerDto(row: ContactsRow | null): StorefrontContactsDto {
  return {
    ...publicDto(row),
    changedByStaffId: row?.changed_by_staff_id ?? null,
    changedAt: row?.changed_at?.toISOString() ?? null,
  };
}
