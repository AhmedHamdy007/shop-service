ALTER TABLE staff_invites
ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;

DROP INDEX IF EXISTS idx_staff_invites_active;

CREATE INDEX IF NOT EXISTS idx_staff_invites_active ON staff_invites(shop_id, expires_at)
WHERE accepted_at IS NULL AND revoked_at IS NULL AND declined_at IS NULL;
