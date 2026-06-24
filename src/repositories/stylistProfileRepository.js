const { query } = require("../db/pool");
const crypto = require("crypto");

function rowToProfile(row) {
  if (!row) return null;
  const matchedServices = Array.isArray(row.matched_services)
    ? row.matched_services
    : [];
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
    depositRequired: Boolean(row.deposit_required),
    shopId: row.shop_id,
    shopName: row.shop_name,
    shopSlug: row.shop_slug,
    shopAddressLine1: row.shop_address_line1,
    shopCity: row.shop_city,
    shopCountry: row.shop_country,
    staffLevel: row.staff_level,
    isBookable:
      row.is_bookable === undefined || row.is_bookable === null
        ? Boolean(row.shop_id && row.shop_name)
        : Boolean(row.is_bookable),
    stripeAccountId: row.stripe_account_id || null,
    stripeOnboardingDone: Boolean(row.stripe_onboarding_done),
    payoutsEnabled: Boolean(row.payouts_enabled),
    chargesEnabled: Boolean(row.charges_enabled),
    portfolioCount:
      row.portfolio_count === undefined || row.portfolio_count === null
        ? undefined
        : Number(row.portfolio_count),
    serviceCount:
      row.service_count === undefined || row.service_count === null
        ? undefined
        : Number(row.service_count),
    matchedServices: matchedServices.map((service) => ({
      id: service.id,
      name: service.name,
      category: service.category || null,
      price: service.price === undefined || service.price === null ? null : Number(service.price),
      durationMinutes:
        service.durationMinutes === undefined || service.durationMinutes === null
          ? null
          : Number(service.durationMinutes),
    })),
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
  serviceName = null,
  city = null,
  shopId = null,
  staffLevel = null,
  sort = "newest",
  limit = 20,
}) {
  const filters = [
    "sp.is_public = true",
  ];
  const params = [];
  const normalizedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 20;
  const sortMap = {
    newest: "sp.created_at DESC",
    experience_desc: "sp.years_experience DESC NULLS LAST, sp.created_at DESC",
    name_asc: "COALESCE(sp.display_name, '') ASC, sp.created_at DESC",
  };
  const orderBy = sortMap[sort] || sortMap.newest;
  let serviceSearchRankSelect = "0 AS service_match_rank";
  let matchedServicesSelect = "'[]'::json AS matched_services";

  if (serviceName) {
    params.push(serviceName);
    const serviceNameIndex = params.length;
    filters.push(
      `EXISTS (
        SELECT 1
        FROM stylist_service_offerings so
        INNER JOIN shop_services svc
          ON svc.id = so.service_id
         AND svc.is_active = true
          WHERE so.stylist_user_id = sp.user_id
            AND so.shop_id = ss.shop_id
            AND so.is_active = true
            AND sh.id IS NOT NULL
            AND svc.name ILIKE $${serviceNameIndex}
      )`
    );
    serviceSearchRankSelect = `CASE WHEN EXISTS (
              SELECT 1
              FROM stylist_service_offerings so
              INNER JOIN shop_services svc
                ON svc.id = so.service_id
               AND svc.is_active = true
              WHERE so.stylist_user_id = sp.user_id
                AND so.shop_id = ss.shop_id
                AND so.is_active = true
                AND sh.id IS NOT NULL
                AND svc.name ILIKE $${serviceNameIndex}
            ) THEN 1 ELSE 0 END AS service_match_rank`;
    matchedServicesSelect = `COALESCE((
              SELECT json_agg(service_row)
              FROM (
                SELECT
                  svc.id,
                  svc.name,
                  svc.category,
                  COALESCE(so.custom_price, svc.price) AS price,
                  COALESCE(so.custom_duration_minutes, svc.duration_minutes) AS "durationMinutes"
                FROM stylist_service_offerings so
                INNER JOIN shop_services svc
                  ON svc.id = so.service_id
                 AND svc.is_active = true
                WHERE so.stylist_user_id = sp.user_id
                  AND so.shop_id = ss.shop_id
                  AND so.is_active = true
                  AND sh.id IS NOT NULL
                  AND svc.name ILIKE $${serviceNameIndex}
                ORDER BY svc.name ASC
                LIMIT 4
              ) service_row
            ), '[]'::json) AS matched_services`;
  }

  if (q) {
    params.push(`%${q}%`);
    const searchIndex = params.length;
    filters.push(
      `(sp.display_name ILIKE $${searchIndex}
        OR sp.bio ILIKE $${searchIndex}
        OR sp.specialties ILIKE $${searchIndex}
        OR EXISTS (
          SELECT 1
          FROM stylist_service_offerings so
          INNER JOIN shop_services svc
            ON svc.id = so.service_id
           AND svc.is_active = true
          WHERE so.stylist_user_id = sp.user_id
            AND so.shop_id = ss.shop_id
            AND so.is_active = true
            AND sh.id IS NOT NULL
            AND (
              svc.name ILIKE $${searchIndex}
              OR svc.category ILIKE $${searchIndex}
              OR svc.description ILIKE $${searchIndex}
            )
        ))`
    );
    if (!serviceName) {
      serviceSearchRankSelect = `CASE WHEN EXISTS (
              SELECT 1
              FROM stylist_service_offerings so
              INNER JOIN shop_services svc
                ON svc.id = so.service_id
               AND svc.is_active = true
              WHERE so.stylist_user_id = sp.user_id
                AND so.shop_id = ss.shop_id
                AND so.is_active = true
                AND sh.id IS NOT NULL
                AND (
                  svc.name ILIKE $${searchIndex}
                  OR svc.category ILIKE $${searchIndex}
                  OR svc.description ILIKE $${searchIndex}
                )
            ) THEN 1 ELSE 0 END AS service_match_rank`;
      matchedServicesSelect = `COALESCE((
              SELECT json_agg(service_row)
              FROM (
                SELECT
                  svc.id,
                  svc.name,
                  svc.category,
                  COALESCE(so.custom_price, svc.price) AS price,
                  COALESCE(so.custom_duration_minutes, svc.duration_minutes) AS "durationMinutes"
                FROM stylist_service_offerings so
                INNER JOIN shop_services svc
                  ON svc.id = so.service_id
                 AND svc.is_active = true
                WHERE so.stylist_user_id = sp.user_id
                  AND so.shop_id = ss.shop_id
                  AND so.is_active = true
                  AND sh.id IS NOT NULL
                  AND (
                    svc.name ILIKE $${searchIndex}
                    OR svc.category ILIKE $${searchIndex}
                    OR svc.description ILIKE $${searchIndex}
                  )
                ORDER BY svc.name ASC
                LIMIT 4
              ) service_row
            ), '[]'::json) AS matched_services`;
    }
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
                AND sh.id IS NOT NULL
            ) AS service_count,
            CASE WHEN ss.shop_id IS NOT NULL AND sh.id IS NOT NULL THEN true ELSE false END AS is_bookable,
            ${serviceSearchRankSelect},
            ${matchedServicesSelect}
     FROM stylist_profiles sp
     LEFT JOIN shop_staff ss
       ON ss.user_id = sp.user_id
      AND ss.status = 'active'
     LEFT JOIN shops sh
       ON sh.id = ss.shop_id
      AND sh.is_active = true
     WHERE ${filters.join(" AND ")}
     ORDER BY service_match_rank DESC, ${orderBy}
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

async function searchProfilesForInvite({ q = null, limit = 20, excludeActiveShopId = null } = {}) {
  const params = [];
  const filters = [];
  const normalizedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 20;

  if (q) {
    params.push(`%${String(q).trim()}%`);
    const searchIndex = params.length;
    filters.push(
      `(sp.display_name ILIKE $${searchIndex}
        OR sp.bio ILIKE $${searchIndex}
        OR sp.specialties ILIKE $${searchIndex}
        OR sp.user_id::text ILIKE $${searchIndex})`
    );
  }

  if (excludeActiveShopId) {
    params.push(String(excludeActiveShopId));
    const shopIndex = params.length;
    filters.push(
      `NOT EXISTS (
        SELECT 1
        FROM shop_staff current_staff
        WHERE current_staff.user_id = sp.user_id
          AND current_staff.shop_id = $${shopIndex}
          AND current_staff.status = 'active'
      )`
    );
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
     ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
     ORDER BY COALESCE(sp.display_name, '') ASC, sp.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map(rowToProfile);
}

module.exports = {
  getByUserId,
  getPublicProfileByIdentifier,
  listPublicProfiles,
  listPublicProfilesByShopId,
  listProfilesByUserIds,
  searchProfilesForInvite,
  upsertByUserId,
};
