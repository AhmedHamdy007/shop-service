DO $$
DECLARE
  shop_id_type TEXT;
  user_id_type TEXT;
  service_id_type TEXT;
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

  SELECT format_type(a.atttypid, a.atttypmod)
  INTO service_id_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'shop_services'
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS stylist_service_offerings (
      id UUID PRIMARY KEY,
      shop_id %s NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      stylist_user_id %s NOT NULL,
      service_id %s NOT NULL REFERENCES shop_services(id) ON DELETE CASCADE,
      custom_price NUMERIC(10, 2),
      custom_duration_minutes SMALLINT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (shop_id, stylist_user_id, service_id)
    )',
    shop_id_type,
    user_id_type,
    service_id_type
  );
END $$;

CREATE INDEX IF NOT EXISTS idx_stylist_service_offerings_stylist
ON stylist_service_offerings(stylist_user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_stylist_service_offerings_shop
ON stylist_service_offerings(shop_id, is_active);
