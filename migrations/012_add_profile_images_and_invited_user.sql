ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS image_url text;

ALTER TABLE stylist_profiles
  ADD COLUMN IF NOT EXISTS profile_image_url text;

ALTER TABLE staff_invites
  ADD COLUMN IF NOT EXISTS invited_user_id text;
