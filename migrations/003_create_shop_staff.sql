DO $$
DECLARE
  shop_id_type TEXT;
  user_id_type TEXT;
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

  SELECT format_type(a.atttypid, a.atttypmod)
  INTO user_id_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'shops'
    AND a.attname = 'owner_user_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS shop_staff (
      id UUID PRIMARY KEY,
      shop_id %s NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      user_id %s NOT NULL,
      role VARCHAR(30) NOT NULL DEFAULT ''stylist'' CHECK (role IN (''stylist'')),
      staff_level VARCHAR(30) NOT NULL CHECK (staff_level IN (''stylist'', ''senior_stylist'')),
      status VARCHAR(20) NOT NULL DEFAULT ''active'' CHECK (status IN (''active'', ''inactive'')),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (shop_id, user_id)
    )',
    shop_id_type,
    user_id_type
  );
END $$;

CREATE INDEX IF NOT EXISTS idx_shop_staff_shop_status ON shop_staff(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_shop_staff_user_id ON shop_staff(user_id);
