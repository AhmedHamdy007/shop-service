const { query } = require("../db/pool");
const crypto = require("crypto");

function rowToProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    bio: row.bio,
    specialties: row.specialties,
    yearsExperience: row.years_experience,
    avatar: {
      url: row.profile_image_url || null,
      publicId: row.profile_image_public_id || null,
    },
    // LEGACY: migrate this field to { url, publicId } object
    profileImageUrl: row.profile_image_url,
    profileImagePublicId: row.profile_image_public_id,
    instagramHandle: row.instagram_handle,
    tiktokHandle: row.tiktok_handle,
    isPublic: row.is_public,
    shopId: row.shop_id,
    shopName: row.shop_name,
    shopSlug: row.shop_slug,
    shopAddressLine1: row.shop_address_line1,
    shopCity: row.shop_city,
    shopCountry: row.shop_country,
    staffLevel: row.staff_level,
    portfolioCount:
      row.portfolio_count === undefined || row.portfolio_count === null
        ? undefined
        : Number(row.portfolio_count),
    serviceCount:
      row.service_count === undefined || row.service_count === null
        ? undefined
        : Number(row.service_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getByUserId(userId) {
  const result = await query(
    `SELECT sp.*,
            ss.shop_id,
            ss.staff_level,
            sh.name AS shop_name,
            sh.slug AS shop_slug,
            sh.address_line1 AS shop_address_line1,
            sh.city AS shop_city,
            sh.country AS shop_country,
            (
              SELECT COUNT(*)::int
              FROM portfolio_posts pp
              WHERE pp.stylist_user_id = sp.user_id
                AND pp.is_published = true
            ) AS portfolio_count,
            (
              SELECT COUNT(*)::int
              FROM stylist_service_offerings so
              WHERE so.stylist_user_id = sp.user_id
                AND so.is_active = true
                AND (ss.shop_id IS NULL OR so.shop_id = ss.shop_id)
            ) AS service_count
     FROM stylist_profiles sp
     LEFT JOIN shop_staff ss
       ON ss.user_id = sp.user_id
      AND ss.status = 'active'
     LEFT JOIN shops sh
       ON sh.id = ss.shop_id
      AND sh.is_active = true
     WHERE sp.user_id = $1
     LIMIT 1`,
    [userId]
  );
  return rowToProfile(result.rows[0]);
}

async function getPublicProfileByIdentifier(identifier) {
  const result = await query(
    `SELECT sp.*,
            ss.shop_id,
            ss.staff_level,
            sh.name AS shop_name,
            sh.slug AS shop_slug,
            sh.address_line1 AS shop_address_line1,
            sh.city AS shop_city,
            sh.country AS shop_country,
            (
              SELECT COUNT(*)::int
              FROM portfolio_posts pp
              WHERE pp.stylist_user_id = sp.user_id
                AND pp.is_published = true
            ) AS portfolio_count,
            (
              SELECT COUNT(*)::int
              FROM stylist_service_offerings so
              WHERE so.stylist_user_id = sp.user_id
                AND so.is_active = true
                AND (ss.shop_id IS NULL OR so.shop_id = ss.shop_id)
            ) AS service_count
     FROM stylist_profiles sp
     LEFT JOIN shop_staff ss
       ON ss.user_id = sp.user_id
      AND ss.status = 'active'
     LEFT JOIN shops sh
       ON sh.id = ss.shop_id
      AND sh.is_active = true
     WHERE sp.user_id::text = $1
        OR sp.id::text = $1
     LIMIT 1`,
    [String(identifier)]
  );
  return rowToProfile(result.rows[0]);
}

async function upsertByUserId(userId, patch) {
  await query(
    `INSERT INTO stylist_profiles (
      id, user_id, display_name, bio, specialties, years_experience, profile_image_url, profile_image_public_id, instagram_handle, tiktok_handle, is_public
    ) VALUES ($1, $2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true)
    ON CONFLICT (user_id) DO NOTHING`,
    [crypto.randomUUID(), userId]
  );

  const fields = [];
  const params = [];
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    params.push(value);
    fields.push(`${key} = $${params.length}`);
  });
  if (fields.length === 0) return getByUserId(userId);

  params.push(userId);
  const result = await query(
    `UPDATE stylist_profiles
     SET ${fields.join(", ")}, updated_at = NOW()
     WHERE user_id = $${params.length}
     RETURNING *`,
    params
  );
  return rowToProfile(result.rows[0]);
}

async function listPublicProfiles({
  q = null,
  city = null,
  shopId = null,
  staffLevel = null,
  sort = "newest",
  limit = 20,
}) {
  const filters = [
    "sp.is_public = true",
    "ss.status = 'active'",
    "sh.is_active = true",
  ];
  const params = [];
  const normalizedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 20;
  const sortMap = {
    newest: "sp.created_at DESC",
    experience_desc: "sp.years_experience DESC NULLS LAST, sp.created_at DESC",
    name_asc: "COALESCE(sp.display_name, '') ASC, sp.created_at DESC",
  };
  const orderBy = sortMap[sort] || sortMap.newest;

  if (q) {
    params.push(`%${q}%`);
    filters.push(
      `(sp.display_name ILIKE $${params.length} OR sp.bio ILIKE $${params.length} OR sp.specialties ILIKE $${params.length})`
    );
  }
  if (city) {
    params.push(city);
    filters.push(`sh.city ILIKE $${params.length}`);
  }
  if (shopId) {
    params.push(shopId);
    filters.push(`ss.shop_id = $${params.length}`);
  }
  if (staffLevel) {
    params.push(staffLevel);
    filters.push(`ss.staff_level = $${params.length}`);
  }

  params.push(normalizedLimit);

  const result = await query(
    `SELECT sp.*,
            ss.shop_id,
            ss.staff_level,
            sh.name AS shop_name,
            sh.slug AS shop_slug,
            sh.address_line1 AS shop_address_line1,
            sh.city AS shop_city,
            sh.country AS shop_country,
            (
              SELECT COUNT(*)::int
              FROM portfolio_posts pp
              WHERE pp.stylist_user_id = sp.user_id
                AND pp.is_published = true
            ) AS portfolio_count,
            (
              SELECT COUNT(*)::int
              FROM stylist_service_offerings so
              WHERE so.stylist_user_id = sp.user_id
                AND so.shop_id = ss.shop_id
                AND so.is_active = true
            ) AS service_count
     FROM stylist_profiles sp
     INNER JOIN shop_staff ss
       ON ss.user_id = sp.user_id
     INNER JOIN shops sh
       ON sh.id = ss.shop_id
     WHERE ${filters.join(" AND ")}
     ORDER BY ${orderBy}
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map(rowToProfile);
}

async function listPublicProfilesByShopId(shopId, { limit = 12 } = {}) {
  const normalizedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 12;
  const result = await query(
    `SELECT sp.*,
            ss.shop_id,
            ss.staff_level,
            sh.name AS shop_name,
            sh.slug AS shop_slug,
            sh.address_line1 AS shop_address_line1,
            sh.city AS shop_city,
            sh.country AS shop_country,
            (
              SELECT COUNT(*)::int
              FROM portfolio_posts pp
              WHERE pp.stylist_user_id = sp.user_id
                AND pp.is_published = true
            ) AS portfolio_count,
            (
              SELECT COUNT(*)::int
              FROM stylist_service_offerings so
              WHERE so.stylist_user_id = sp.user_id
                AND so.shop_id = ss.shop_id
                AND so.is_active = true
            ) AS service_count
     FROM stylist_profiles sp
     INNER JOIN shop_staff ss
       ON ss.user_id = sp.user_id
      AND ss.status = 'active'
     INNER JOIN shops sh
       ON sh.id = ss.shop_id
      AND sh.is_active = true
     WHERE sp.is_public = true
       AND ss.shop_id = $1
     ORDER BY ss.staff_level DESC, sp.created_at DESC
     LIMIT $2`,
    [shopId, normalizedLimit]
  );

  return result.rows.map(rowToProfile);
}

async function listProfilesByUserIds(userIds = []) {
  const normalizedIds = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!normalizedIds.length) return [];

  const result = await query(
    `SELECT sp.*,
            ss.shop_id,
            ss.staff_level,
            sh.name AS shop_name,
            sh.slug AS shop_slug,
            sh.address_line1 AS shop_address_line1,
            sh.city AS shop_city,
            sh.country AS shop_country,
            (
              SELECT COUNT(*)::int
              FROM portfolio_posts pp
              WHERE pp.stylist_user_id = sp.user_id
                AND pp.is_published = true
            ) AS portfolio_count,
            (
              SELECT COUNT(*)::int
              FROM stylist_service_offerings so
              WHERE so.stylist_user_id = sp.user_id
                AND so.is_active = true
                AND (ss.shop_id IS NULL OR so.shop_id = ss.shop_id)
            ) AS service_count
     FROM stylist_profiles sp
     LEFT JOIN shop_staff ss
       ON ss.user_id = sp.user_id
      AND ss.status = 'active'
     LEFT JOIN shops sh
       ON sh.id = ss.shop_id
      AND sh.is_active = true
     WHERE sp.user_id = ANY($1::text[])`,
    [normalizedIds]
  );

  return result.rows.map(rowToProfile);
}

module.exports = {
  getByUserId,
  getPublicProfileByIdentifier,
  listPublicProfiles,
  listPublicProfilesByShopId,
  listProfilesByUserIds,
  upsertByUserId,
};
