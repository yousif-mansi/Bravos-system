CREATE TABLE "user" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL,
  "image" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  "username" TEXT UNIQUE,
  "displayUsername" TEXT,
  "role" TEXT,
  "banned" BOOLEAN,
  "banReason" TEXT,
  "banExpires" TIMESTAMPTZ
);

CREATE TABLE "session" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "impersonatedBy" TEXT
);

CREATE TABLE "account" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE TABLE "verification" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE TABLE branch (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT branch_code_known CHECK (code IN ('abshway', 'fayoum'))
);

INSERT INTO branch (id, code, name_ar)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'abshway', 'أبشواي'),
  ('22222222-2222-4222-8222-222222222222', 'fayoum', 'الفيوم');

CREATE TABLE staff_profile (
  staff_id TEXT PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  display_name_ar TEXT NOT NULL,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_staff_id TEXT REFERENCES staff_profile (staff_id),
  last_changed_by_staff_id TEXT REFERENCES staff_profile (staff_id),
  last_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX staff_profile_one_owner ON staff_profile (is_owner) WHERE is_owner;

CREATE TABLE staff_branch_grant (
  staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branch (id),
  cashier BOOLEAN NOT NULL DEFAULT FALSE,
  order_representative BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (staff_id, branch_id),
  CONSTRAINT staff_branch_grant_capability CHECK (cashier OR order_representative)
);

CREATE TABLE staff_session_branch (
  session_id TEXT PRIMARY KEY REFERENCES "session" ("id") ON DELETE CASCADE,
  staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branch (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE owner_recovery_challenge (
  id UUID PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX owner_recovery_challenge_hash ON owner_recovery_challenge (token_hash);
CREATE UNIQUE INDEX owner_recovery_unused_hash
  ON owner_recovery_challenge (token_hash)
  WHERE consumed_at IS NULL;

CREATE TABLE staff_operation (
  id UUID PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_profile (staff_id) ON DELETE CASCADE,
  actor_staff_id TEXT REFERENCES staff_profile (staff_id),
  operation TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_operation_known CHECK (
    operation IN ('provision', 'reset_password', 'disable', 'replace_grants')
  )
);

CREATE INDEX staff_operation_staff ON staff_operation (staff_id, occurred_at);
