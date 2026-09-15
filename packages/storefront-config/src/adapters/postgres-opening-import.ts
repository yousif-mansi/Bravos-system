import type { PoolClient } from "pg";
import type { OpeningStorefrontConfigTransaction } from "../application/ports.ts";

const EMPTY = { whatsappUrl: null, facebookUrl: null, instagramUrl: null, tiktokUrl: null };

export function createPostgresOpeningStorefrontConfigTransaction(client: PoolClient): OpeningStorefrontConfigTransaction {
  return {
    async inspectOpeningContacts() {
      const result = await client.query<{ whatsapp_url: string | null; facebook_url: string | null; instagram_url: string | null; tiktok_url: string | null }>("SELECT whatsapp_url,facebook_url,instagram_url,tiktok_url FROM storefront_contacts WHERE id='default'");
      const row = result.rows[0];
      return row ? { whatsappUrl: row.whatsapp_url, facebookUrl: row.facebook_url, instagramUrl: row.instagram_url, tiktokUrl: row.tiktok_url } : EMPTY;
    },
    async upsertOpeningContacts(input) {
      await client.query(`INSERT INTO storefront_contacts (id,whatsapp_url,facebook_url,instagram_url,tiktok_url,changed_by_staff_id,changed_at)
        VALUES ('default',$1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO UPDATE SET whatsapp_url=EXCLUDED.whatsapp_url,facebook_url=EXCLUDED.facebook_url,instagram_url=EXCLUDED.instagram_url,tiktok_url=EXCLUDED.tiktok_url,changed_by_staff_id=EXCLUDED.changed_by_staff_id,changed_at=EXCLUDED.changed_at`,[input.whatsappUrl,input.facebookUrl,input.instagramUrl,input.tiktokUrl,input.actorStaffId,input.at]);
    },
  };
}
