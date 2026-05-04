ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS image_public_id text;

ALTER TABLE stylist_profiles
  ADD COLUMN IF NOT EXISTS profile_image_public_id text;

ALTER TABLE portfolio_posts
  ADD COLUMN IF NOT EXISTS category varchar(20) NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'portfolio_posts_category_check'
  ) THEN
    ALTER TABLE portfolio_posts
      ADD CONSTRAINT portfolio_posts_category_check
      CHECK (category IN ('cut', 'colour', 'texture', 'beard', 'other'));
  END IF;
END $$;

ALTER TABLE portfolio_media
  ADD COLUMN IF NOT EXISTS media_public_id text;

CREATE INDEX IF NOT EXISTS idx_portfolio_posts_display_order
  ON portfolio_posts(stylist_user_id, display_order ASC, created_at DESC);
