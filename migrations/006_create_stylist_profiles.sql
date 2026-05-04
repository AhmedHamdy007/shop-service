DO $$
DECLARE
  user_id_type TEXT;
BEGIN
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
    'CREATE TABLE IF NOT EXISTS stylist_profiles (
      id UUID PRIMARY KEY,
      user_id %s NOT NULL UNIQUE,
      display_name VARCHAR(120),
      bio TEXT,
      specialties TEXT,
      years_experience SMALLINT,
      instagram_handle VARCHAR(120),
      tiktok_handle VARCHAR(120),
      is_public BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )',
    user_id_type
  );
END $$;

CREATE INDEX IF NOT EXISTS idx_stylist_profiles_user_id ON stylist_profiles(user_id);
