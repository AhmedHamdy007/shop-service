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
    AND c.relname = 'stylist_profiles'
    AND a.attname = 'user_id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS stylist_payout_profiles (
      id UUID PRIMARY KEY,
      stylist_id %s NOT NULL UNIQUE REFERENCES stylist_profiles(user_id) ON DELETE CASCADE,
      stripe_account_id VARCHAR(255) NOT NULL,
      bank_name VARCHAR(100) NOT NULL,
      account_number_enc TEXT NOT NULL,
      account_number_last4 VARCHAR(4) NOT NULL,
      account_name VARCHAR(255) NOT NULL,
      ic_number_enc TEXT NOT NULL,
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )',
    user_id_type
  );
END $$;

CREATE INDEX IF NOT EXISTS idx_stylist_payout_profiles_stylist_id
ON stylist_payout_profiles(stylist_id);
