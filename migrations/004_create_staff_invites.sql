DO $$
DECLARE
  shop_id_type TEXT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
  INTO shop_id_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'shops'
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS staff_invites (
      id UUID PRIMARY KEY,
      shop_id %s NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      staff_level VARCHAR(30) NOT NULL CHECK (staff_level IN (''stylist'', ''senior_stylist'')),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )',
    shop_id_type
  );
END $$;

CREATE INDEX IF NOT EXISTS idx_staff_invites_shop_email ON staff_invites(shop_id, email);
CREATE INDEX IF NOT EXISTS idx_staff_invites_active ON staff_invites(shop_id, expires_at)
WHERE accepted_at IS NULL AND revoked_at IS NULL;
