ALTER TABLE stylist_profiles
ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_onboarding_done BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS charges_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE shops
ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_onboarding_done BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS charges_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE stylist_payout_profiles
ADD COLUMN IF NOT EXISTS payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS charges_enabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE stylist_profiles sp
SET stripe_account_id = spp.stripe_account_id,
    stripe_onboarding_done = spp.is_verified,
    payouts_enabled = spp.is_verified,
    charges_enabled = COALESCE(spp.charges_enabled, FALSE)
FROM stylist_payout_profiles spp
WHERE spp.stylist_id = sp.user_id
  AND sp.stripe_account_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stylist_profiles_stripe_account_id
ON stylist_profiles(stripe_account_id)
WHERE stripe_account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_stripe_account_id
ON shops(stripe_account_id)
WHERE stripe_account_id IS NOT NULL;
