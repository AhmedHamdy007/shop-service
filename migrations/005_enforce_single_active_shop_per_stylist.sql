CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_staff_single_active_stylist
ON shop_staff(user_id)
WHERE status = 'active';
