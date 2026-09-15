CREATE TABLE storefront_contacts (
  id TEXT PRIMARY KEY,
  whatsapp_url TEXT,
  facebook_url TEXT,
  instagram_url TEXT,
  tiktok_url TEXT,
  changed_by_staff_id TEXT REFERENCES staff_profile (staff_id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ,
  CONSTRAINT storefront_contacts_singleton CHECK (id = 'default'),
  CONSTRAINT storefront_contacts_whatsapp_len CHECK (whatsapp_url IS NULL OR char_length(whatsapp_url) <= 500),
  CONSTRAINT storefront_contacts_facebook_len CHECK (facebook_url IS NULL OR char_length(facebook_url) <= 500),
  CONSTRAINT storefront_contacts_instagram_len CHECK (instagram_url IS NULL OR char_length(instagram_url) <= 500),
  CONSTRAINT storefront_contacts_tiktok_len CHECK (tiktok_url IS NULL OR char_length(tiktok_url) <= 500)
);
