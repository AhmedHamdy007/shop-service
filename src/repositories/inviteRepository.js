const crypto = require("crypto");
const { query } = require("../db/pool");

function tokenHash(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function rowToInvite(row) {
  if (!row) return null;
  return {
    id: row.id,
    shopId: row.shop_id,
    shopName: row.shop_name,
    shopSlug: row.shop_slug,
    shopCity: row.shop_city,
    shopCountry: row.shop_country,
    ownerUserId: row.owner_user_id,
    invitedUserId: row.invited_user_id,
    email: row.email,
    staffLevel: row.staff_level,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    declinedAt: row.declined_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const inviteSelect = `SELECT si.*,
                             sh.name AS shop_name,
                             sh.slug AS shop_slug,
                             sh.city AS shop_city,
                             sh.country AS shop_country,
                             sh.owner_user_id
                      FROM staff_invites si
                      INNER JOIN shops sh ON sh.id = si.shop_id`;

async function createInvite({ shopId, email, staffLevel, token, expiresAt, invitedUserId = null }) {
  const result = await query(
    `INSERT INTO staff_invites (id, shop_id, invited_user_id, email, staff_level, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [crypto.randomUUID(), shopId, invitedUserId, email, staffLevel, tokenHash(token), expiresAt]
  );
  return rowToInvite(result.rows[0]);
}

async function listInvitesByShop(shopId) {
  const result = await query(
    `${inviteSelect}
     WHERE si.shop_id = $1
     ORDER BY si.created_at DESC`,
    [shopId]
  );
  return result.rows.map(rowToInvite);
}

async function findActiveInviteByShopAndEmail(shopId, email) {
  const result = await query(
    `${inviteSelect}
     WHERE si.shop_id = $1
       AND si.email = $2
       AND si.accepted_at IS NULL
       AND si.revoked_at IS NULL
       AND si.declined_at IS NULL
       AND si.expires_at > NOW()
     LIMIT 1`,
    [shopId, email]
  );
  return rowToInvite(result.rows[0]);
}

async function findInviteById(inviteId) {
  const result = await query(`${inviteSelect} WHERE si.id = $1 LIMIT 1`, [inviteId]);
  return rowToInvite(result.rows[0]);
}

async function findActiveInviteByToken(token) {
  const result = await query(
    `${inviteSelect}
     WHERE si.token_hash = $1
       AND si.accepted_at IS NULL
       AND si.revoked_at IS NULL
       AND si.declined_at IS NULL
       AND si.expires_at > NOW()
     LIMIT 1`,
    [tokenHash(token)]
  );
  return rowToInvite(result.rows[0]);
}

async function listActiveInvitesByEmail(email) {
  const result = await query(
    `${inviteSelect}
     WHERE LOWER(si.email) = LOWER($1)
       AND si.accepted_at IS NULL
       AND si.revoked_at IS NULL
       AND si.declined_at IS NULL
       AND si.expires_at > NOW()
       AND sh.is_active = true
     ORDER BY si.created_at DESC`,
    [email]
  );
  return result.rows.map(rowToInvite);
}

async function markInviteAccepted(inviteId) {
  const result = await query(
    `UPDATE staff_invites
     SET accepted_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [inviteId]
  );
  return rowToInvite(result.rows[0]);
}

async function revokeInvite(inviteId) {
  const result = await query(
    `UPDATE staff_invites
     SET revoked_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [inviteId]
  );
  return rowToInvite(result.rows[0]);
}

async function rejectInvite(inviteId) {
  const result = await query(
    `UPDATE staff_invites
     SET declined_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [inviteId]
  );
  return rowToInvite(result.rows[0]);
}

module.exports = {
  createInvite,
  listInvitesByShop,
  findActiveInviteByShopAndEmail,
  findInviteById,
  findActiveInviteByToken,
  listActiveInvitesByEmail,
  markInviteAccepted,
  revokeInvite,
  rejectInvite,
};
