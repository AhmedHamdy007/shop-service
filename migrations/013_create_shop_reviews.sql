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
    'CREATE TABLE IF NOT EXISTS shop_reviews (
      id UUID PRIMARY KEY,
      shop_id %s NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      stylist_user_id %s,
      customer_user_id %s NOT NULL,
      booking_id VARCHAR(120) NOT NULL UNIQUE,
      service_name VARCHAR(160),
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      technique_rating SMALLINT CHECK (technique_rating BETWEEN 1 AND 5),
      communication_rating SMALLINT CHECK (communication_rating BETWEEN 1 AND 5),
      value_rating SMALLINT CHECK (value_rating BETWEEN 1 AND 5),
      atmosphere_rating SMALLINT CHECK (atmosphere_rating BETWEEN 1 AND 5),
      review_text TEXT NOT NULL,
      photo_urls JSONB NOT NULL DEFAULT ''[]''::jsonb,
      is_published BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )',
    shop_id_type,
    user_id_type,
    user_id_type
  );
END $$;

CREATE INDEX IF NOT EXISTS idx_shop_reviews_shop_created ON shop_reviews(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_reviews_stylist_created ON shop_reviews(stylist_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_reviews_customer_created ON shop_reviews(customer_user_id, created_at DESC);
