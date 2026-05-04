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
    'CREATE TABLE IF NOT EXISTS portfolio_posts (
      id UUID PRIMARY KEY,
      stylist_user_id %s NOT NULL,
      title VARCHAR(140),
      caption TEXT,
      is_published BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )',
    user_id_type
  );
END $$;

CREATE INDEX IF NOT EXISTS idx_portfolio_posts_stylist ON portfolio_posts(stylist_user_id, is_published);

CREATE TABLE IF NOT EXISTS portfolio_media (
  id UUID PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES portfolio_posts(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_media_post_id ON portfolio_media(post_id);
