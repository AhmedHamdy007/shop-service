const { query } = require("../db/pool");
const crypto = require("crypto");

function rowToStaff(row) {
  if (!row) return null;
  return {
    id: row.id,
    shopId: row.shop_id,
    userId: row.user_id,
    role: row.role,
    staffLevel: row.staff_level,
    status: row.status,
    joinedAt: row.joined_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    displayName: row.display_name,
    stylistName: row.display_name,
    avatar: {
      url: row.profile_image_url || null,
      publicId: row.profile_image_public_id || null,
    },
    // LEGACY: migrate this field to { url, publicId } object
    profileImageUrl: row.profile_image_url,
    profileImagePublicId: row.profile_image_public_id,
    specialties: row.specialties,
    yearsExperience: row.years_experience,
    depositRequired: Boolean(row.deposit_required),
  };
}

async function listStaffByShop(shopId) {
  const result = await query(
    `SELECT ss.*, sp.display_name, sp.profile_image_url, sp.profile_image_public_id, sp.specialties, sp.years_experience, sp.deposit_required
     FROM shop_staff ss
     LEFT JOIN stylist_profiles sp ON sp.user_id = ss.user_id
     WHERE ss.shop_id = $1
     ORDER BY ss.created_at DESC`,
    [shopId]
  );
  return result.rows.map(rowToStaff);
}

async function listActiveStylistsByShop(shopId) {
  const result = await query(
    `SELECT ss.*, sp.display_name, sp.profile_image_url, sp.profile_image_public_id, sp.specialties, sp.years_experience, sp.deposit_required
     FROM shop_staff ss
     LEFT JOIN stylist_profiles sp ON sp.user_id = ss.user_id
     WHERE ss.shop_id = $1
       AND ss.status = 'active'
     ORDER BY ss.created_at DESC`,
    [shopId]
  );
  return result.rows.map(rowToStaff);
}

async function findStaffById(staffId) {
  const result = await query("SELECT * FROM shop_staff WHERE id = $1 LIMIT 1", [staffId]);
  return rowToStaff(result.rows[0]);
}

async function findStaffByShopAndUser(shopId, userId) {
  const result = await query(
    `SELECT ss.*, sp.display_name, sp.profile_image_url, sp.profile_image_public_id, sp.specialties, sp.years_experience, sp.deposit_required
     FROM shop_staff ss
     LEFT JOIN stylist_profiles sp ON sp.user_id = ss.user_id
     WHERE ss.shop_id = $1
       AND ss.user_id = $2
     LIMIT 1`,
    [shopId, userId]
  );
  return rowToStaff(result.rows[0]);
}

async function findActiveMembershipByUser(userId) {
  const result = await query(
    `SELECT *
     FROM shop_staff
     WHERE user_id = $1
       AND status = 'active'
     LIMIT 1`,
    [userId]
  );
  return rowToStaff(result.rows[0]);
}

async function createStaffMembership({ shopId, userId, staffLevel }) {
  const result = await query(
    `INSERT INTO shop_staff (id, shop_id, user_id, role, staff_level, status)
     VALUES ($1, $2, $3, 'stylist', $4, 'active')
     RETURNING *`,
    [crypto.randomUUID(), shopId, userId, staffLevel]
  );
  return rowToStaff(result.rows[0]);
}

async function updateStaffById(staffId, patch) {
  const fields = [];
  const params = [];
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    params.push(value);
    fields.push(`${key} = $${params.length}`);
  });
  if (fields.length === 0) return findStaffById(staffId);

  params.push(staffId);
  const result = await query(
    `UPDATE shop_staff
     SET ${fields.join(", ")}, updated_at = NOW()
     WHERE id = $${params.length}
     RETURNING *`,
    params
  );
  return rowToStaff(result.rows[0]);
}

async function listShopsForStylist(userId) {
  const result = await query(
    `SELECT s.*
     FROM shops s
     INNER JOIN shop_staff ss ON ss.shop_id = s.id
     WHERE ss.user_id = $1
       AND ss.status = 'active'
       AND s.is_active = true
     ORDER BY s.created_at DESC`,
    [userId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    slug: row.slug,
    addressLine1: row.address_line1,
    city: row.city,
    country: row.country,
    phone: row.phone,
    email: row.email,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

module.exports = {
  listStaffByShop,
  listActiveStylistsByShop,
  findStaffById,
  findStaffByShopAndUser,
  findActiveMembershipByUser,
  createStaffMembership,
  updateStaffById,
  listShopsForStylist,
};
