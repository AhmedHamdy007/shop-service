CREATE INDEX IF NOT EXISTS idx_shops_owner_active
ON shops(owner_user_id, is_active);
