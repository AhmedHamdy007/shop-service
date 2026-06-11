const crypto = require("crypto");
const { query } = require("../db/pool");

function maskLast4(last4) {
  return last4 ? `****${String(last4).slice(-4)}` : null;
}

function rowToPayoutProfile(row, { includeStripeAccountId = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    stylistId: row.stylist_id,
    bankName: row.bank_name,
    accountName: row.account_name,
    accountNumberMasked: maskLast4(row.account_number_last4),
    isVerified: Boolean(row.is_verified),
    payoutsEnabled: Boolean(row.payouts_enabled),
    chargesEnabled: Boolean(row.charges_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(includeStripeAccountId ? { stripeAccountId: row.stripe_account_id } : {}),
  };
}

async function findPayoutProfileByStylistId(stylistId, options = {}) {
  const result = await query(
    "SELECT * FROM stylist_payout_profiles WHERE stylist_id = $1 LIMIT 1",
    [stylistId]
  );
  return rowToPayoutProfile(result.rows[0], options);
}

async function createPayoutProfile({
  stylistId,
  stripeAccountId,
  bankName,
  accountNumberEnc,
  accountNumberLast4,
  accountName,
  icNumberEnc,
  isVerified = false,
}) {
  const result = await query(
    `INSERT INTO stylist_payout_profiles (
      id,
      stylist_id,
      stripe_account_id,
      bank_name,
      account_number_enc,
      account_number_last4,
      account_name,
      ic_number_enc,
      is_verified
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      crypto.randomUUID(),
      stylistId,
      stripeAccountId,
      bankName,
      accountNumberEnc,
      accountNumberLast4,
      accountName,
      icNumberEnc,
      isVerified,
    ]
  );
  return rowToPayoutProfile(result.rows[0]);
}

async function updatePayoutProfileByStylistId(stylistId, patch) {
  const fields = [];
  const params = [];

  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    params.push(value);
    fields.push(`${key} = $${params.length}`);
  });

  if (fields.length === 0) {
    return findPayoutProfileByStylistId(stylistId);
  }

  params.push(stylistId);
  const result = await query(
    `UPDATE stylist_payout_profiles
     SET ${fields.join(", ")}, updated_at = NOW()
     WHERE stylist_id = $${params.length}
     RETURNING *`,
    params
  );
  return rowToPayoutProfile(result.rows[0]);
}

module.exports = {
  createPayoutProfile,
  findPayoutProfileByStylistId,
  updatePayoutProfileByStylistId,
};
