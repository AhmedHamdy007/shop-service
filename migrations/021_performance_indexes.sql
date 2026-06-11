CREATE INDEX IF NOT EXISTS idx_shop_services_shop_active_created
ON shop_services(shop_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_staff_shop_user_status
ON shop_staff(shop_id, user_id, status);

CREATE INDEX IF NOT EXISTS idx_shop_staff_user_status
ON shop_staff(user_id, status);

CREATE INDEX IF NOT EXISTS idx_staff_invites_lower_email_active
ON staff_invites(LOWER(email), shop_id, created_at DESC)
WHERE accepted_at IS NULL
  AND revoked_at IS NULL
  AND declined_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_portfolio_posts_stylist_display
ON portfolio_posts(stylist_user_id, is_published, display_order ASC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_reviews_booking_id
ON shop_reviews(booking_id);

CREATE INDEX IF NOT EXISTS idx_stylist_service_offerings_lookup
ON stylist_service_offerings(shop_id, stylist_user_id, service_id, is_active);

CREATE INDEX IF NOT EXISTS idx_stylist_profiles_public_created
ON stylist_profiles(is_public, created_at DESC);
