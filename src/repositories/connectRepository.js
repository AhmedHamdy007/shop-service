const crypto = require("crypto");
const { query } = require("../db/pool");

function rowToConnectAccount(row) {
  if (!row) return null;
  return {
    source: row.source,
    id: row.id,
    userId: row.user_id || row.owner_user_id,
    role: row.role,
    shopId: row.shop_id || null,
    stripeAccountId: row.stripe_account_id || null,
    stripeOnboardingDone: Boolean(row.stripe_onboarding_done),
    payoutsEnabled: Boolean(row.payouts_enabled),
    chargesEnabled: Boolean(row.charges_enabled),
    updatedAt: row.updated_at,
  };
}

async function ensureStylistProfile(userId) {
  await query(
    `INSERT INTO stylist_profiles (
      id, user_id, display_name, bio, specialties, years_experience, instagram_handle, tiktok_handle, is_public
    ) VALUES ($1, $2, NULL, NULL, NULL, NULL, NULL, NULL, true)
    ON CONFLICT (user_id) DO NOTHING`,
    [crypto.randomUUID(), userId]
  );
}

async function findStylistConnectAccount(stylistUserId) {
  const result = await query(
    `SELECT 'stylist' AS source,
            'stylist' AS role,
            sp.id,
            sp.user_id,
            NULL::text AS shop_id,
            sp.stripe_account_id,
            sp.stripe_onboarding_done,
            sp.payouts_enabled,
            sp.charges_enabled,
            sp.updated_at
     FROM stylist_profiles sp
     WHERE sp.user_id = $1
     LIMIT 1`,
    [stylistUserId]
  );
  return rowToConnectAccount(result.rows[0]);
}

async function findOwnerConnectAccount(ownerUserId) {
  const result = await query(
    `SELECT 'shop' AS source,
            'owner' AS role,
            s.id,
            s.owner_user_id,
            s.id::text AS shop_id,
            s.stripe_account_id,
            s.stripe_onboarding_done,
            s.payouts_enabled,
            s.charges_enabled,
            s.updated_at
     FROM shops s
     WHERE s.owner_user_id = $1
       AND s.is_active = true
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [ownerUserId]
  );
  return rowToConnectAccount(result.rows[0]);
}

async function findConnectAccountForPrincipal({ userId, role }) {
  if (role === "stylist") return findStylistConnectAccount(userId);
  if (role === "owner") return findOwnerConnectAccount(userId);
  return null;
}

async function updateStylistConnectAccount(stylistUserId, patch) {
  await ensureStylistProfile(stylistUserId);
  const fields = [];
  const params = [];
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    params.push(value);
    fields.push(`${key} = $${params.length}`);
  });
  if (!fields.length) return findStylistConnectAccount(stylistUserId);

  params.push(stylistUserId);
  const result = await query(
    `UPDATE stylist_profiles
     SET ${fields.join(", ")}, updated_at = NOW()
     WHERE user_id = $${params.length}
     RETURNING 'stylist' AS source,
               'stylist' AS role,
               id,
               user_id,
               NULL::text AS shop_id,
               stripe_account_id,
               stripe_onboarding_done,
               payouts_enabled,
               charges_enabled,
               updated_at`,
    params
  );
  return rowToConnectAccount(result.rows[0]);
}

async function updateOwnerConnectAccount(ownerUserId, patch) {
  const fields = [];
  const params = [];
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    params.push(value);
    fields.push(`${key} = $${params.length}`);
  });
  if (!fields.length) return findOwnerConnectAccount(ownerUserId);

  params.push(ownerUserId);
  const result = await query(
    `UPDATE shops
     SET ${fields.join(", ")}, updated_at = NOW()
     WHERE owner_user_id = $${params.length}
       AND is_active = true
     RETURNING 'shop' AS source,
               'owner' AS role,
               id,
               owner_user_id,
               id::text AS shop_id,
               stripe_account_id,
               stripe_onboarding_done,
               payouts_enabled,
               charges_enabled,
               updated_at`,
    params
  );
  return rowToConnectAccount(result.rows[0]);
}

async function updateConnectAccountForPrincipal({ userId, role, patch }) {
  if (role === "stylist") return updateStylistConnectAccount(userId, patch);
  if (role === "owner") return updateOwnerConnectAccount(userId, patch);
  return null;
}

async function findConnectAccountByStripeAccountId(stripeAccountId) {
  const stylist = await query(
    `SELECT 'stylist' AS source,
            'stylist' AS role,
            sp.id,
            sp.user_id,
            NULL::text AS shop_id,
            sp.stripe_account_id,
            sp.stripe_onboarding_done,
            sp.payouts_enabled,
            sp.charges_enabled,
            sp.updated_at
     FROM stylist_profiles sp
     WHERE sp.stripe_account_id = $1
     LIMIT 1`,
    [stripeAccountId]
  );
  if (stylist.rows[0]) return rowToConnectAccount(stylist.rows[0]);

  const shop = await query(
    `SELECT 'shop' AS source,
            'owner' AS role,
            s.id,
            s.owner_user_id,
            s.id::text AS shop_id,
            s.stripe_account_id,
            s.stripe_onboarding_done,
            s.payouts_enabled,
            s.charges_enabled,
            s.updated_at
     FROM shops s
     WHERE s.stripe_account_id = $1
     LIMIT 1`,
    [stripeAccountId]
  );
  return rowToConnectAccount(shop.rows[0]);
}

async function updateConnectAccountByStripeAccountId(stripeAccountId, patch) {
  const account = await findConnectAccountByStripeAccountId(stripeAccountId);
  if (!account) return null;

  const dbPatch = {
    payouts_enabled: patch.payoutsEnabled,
    charges_enabled: patch.chargesEnabled,
    stripe_onboarding_done: patch.stripeOnboardingDone,
  };

  if (account.role === "stylist") {
    const updated = await updateStylistConnectAccount(account.userId, dbPatch);
    await query(
      `UPDATE stylist_payout_profiles
       SET is_verified = $2,
           payouts_enabled = $3,
           charges_enabled = $4,
           updated_at = NOW()
       WHERE stripe_account_id = $1`,
      [
        stripeAccountId,
        Boolean(patch.stripeOnboardingDone),
        Boolean(patch.payoutsEnabled),
        Boolean(patch.chargesEnabled),
      ]
    );
    return updated;
  }

  return updateOwnerConnectAccount(account.userId, dbPatch);
}

async function clearConnectAccountByStripeAccountId(stripeAccountId) {
  const account = await findConnectAccountByStripeAccountId(stripeAccountId);
  if (!account) return null;

  const dbPatch = {
    stripe_account_id: null,
    stripe_onboarding_done: false,
    payouts_enabled: false,
    charges_enabled: false,
  };

  if (account.role === "stylist") {
    const updated = await updateStylistConnectAccount(account.userId, dbPatch);
    await query(
      `UPDATE stylist_payout_profiles
       SET is_verified = false,
           payouts_enabled = false,
           charges_enabled = false,
           updated_at = NOW()
       WHERE stripe_account_id = $1`,
      [stripeAccountId]
    );
    return updated;
  }

  return updateOwnerConnectAccount(account.userId, dbPatch);
}

module.exports = {
  findConnectAccountByStripeAccountId,
  findConnectAccountForPrincipal,
  findStylistConnectAccount,
  updateConnectAccountByStripeAccountId,
  updateConnectAccountForPrincipal,
  clearConnectAccountByStripeAccountId,
};
