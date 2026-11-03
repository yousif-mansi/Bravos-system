-- Sales-owned till prefix registry. The prefix sequence is separate from sales_sale_reference_number_seq.
-- A registration id is a numbering incarnation, not the device id. Prefixes are never recycled.
-- This table is written only from the POS snapshot restore-control transaction, like known tills,
-- so it stays available during a restore pause and is exempt from the business-write guard.
CREATE SEQUENCE sales_receipt_prefix_seq AS bigint START WITH 1 MINVALUE 1;

CREATE TABLE sales_receipt_registration (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL,
  prefix text NOT NULL UNIQUE CHECK (prefix ~ '^[1-9][0-9]*$'),
  created_at timestamptz NOT NULL,
  created_by_staff_id text NOT NULL REFERENCES staff_profile (staff_id),
  restore_generation bigint NOT NULL CHECK (restore_generation >= 0)
);

-- Nullable until a completed sale claims a number. Assignment is enforced here; attaching a claim is separate.
ALTER TABLE sales_sale ADD COLUMN receipt_identity jsonb;

ALTER TABLE sales_sale ADD CONSTRAINT sales_sale_receipt_identity_shape CHECK (
  receipt_identity IS NULL
  OR (
    (
      jsonb_typeof(receipt_identity) = 'object'
      AND receipt_identity->>'status' IN ('assigned', 'conflict')
      AND (
        (
          receipt_identity->>'status' = 'assigned'
          AND (receipt_identity->>'registrationId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND (receipt_identity->>'deviceId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND (receipt_identity->>'prefix') ~ '^[1-9][0-9]*$'
          AND (receipt_identity->>'sequence') ~ '^[1-9][0-9]*$'
          AND receipt_identity->>'reference' = (
            'BRV-'
            || lpad(receipt_identity->>'prefix', GREATEST(3, length(receipt_identity->>'prefix')), '0')
            || '-'
            || lpad(receipt_identity->>'sequence', GREATEST(6, length(receipt_identity->>'sequence')), '0')
          )
        )
        OR (
          receipt_identity->>'status' = 'conflict'
          AND (
            receipt_identity->>'reference' IS NULL
            OR (
              receipt_identity->>'reference' !~ '[[:cntrl:]]'
              AND (
                char_length(receipt_identity->>'reference') BETWEEN 1 AND 80
                OR (
                  (regexp_replace(substring(receipt_identity->>'reference' from '^BRV-([0-9]{3,})-'), '^0+', '')) ~ '^[1-9][0-9]*$'
                  AND (regexp_replace(substring(receipt_identity->>'reference' from '-([0-9]{6,})$'), '^0+', '')) ~ '^[1-9][0-9]*$'
                  AND receipt_identity->>'reference' = (
                    'BRV-'
                    || lpad(
                      regexp_replace(substring(receipt_identity->>'reference' from '^BRV-([0-9]{3,})-'), '^0+', ''),
                      GREATEST(3, length(regexp_replace(substring(receipt_identity->>'reference' from '^BRV-([0-9]{3,})-'), '^0+', ''))),
                      '0'
                    )
                    || '-'
                    || lpad(
                      regexp_replace(substring(receipt_identity->>'reference' from '-([0-9]{6,})$'), '^0+', ''),
                      GREATEST(6, length(regexp_replace(substring(receipt_identity->>'reference' from '-([0-9]{6,})$'), '^0+', ''))),
                      '0'
                    )
                  )
                )
              )
            )
          )
        )
      )
    ) IS TRUE
  )
);

CREATE UNIQUE INDEX sales_sale_receipt_reference_assigned_uidx
  ON sales_sale ((receipt_identity->>'reference'))
  WHERE receipt_identity->>'status' = 'assigned';
