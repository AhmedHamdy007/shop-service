const { query } = require("../db/pool");

function normalizeTargetType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!["stylist", "salon"].includes(normalized)) {
    const error = new Error("targetType must be stylist or salon");
    error.status = 400;
    throw error;
  }
  return normalized;
}

function normalizeTargetId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const error = new Error("targetId is required");
    error.status = 400;
    throw error;
  }
  return normalized;
}

function rowToSave(row) {
  if (!row) return null;
  const type = row.target_type;
  const location = [row.address_line1, row.city, row.country].filter(Boolean).join(", ");
  return {
    id: row.target_id,
    targetId: row.target_id,
    targetType: type,
    type,
    savedAt: row.saved_at,
    name: row.name || (type === "salon" ? "Salon" : "Stylist"),
    subtitle: row.subtitle || (type === "salon" ? "Salon" : "Stylist"),
    avatar: row.avatar_url || null,
    img: row.avatar_url || null,
    location,
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    reviews: row.review_count === null || row.review_count === undefined ? 0 : Number(row.review_count),
    href: type === "salon" ? `/shop/${row.target_id}` : `/stylist/${row.target_id}`,
    bookState: type === "salon"
      ? { shopId: row.target_id }
      : { stylistId: row.target_id },
  };
}

async function saveTarget({ customerId, targetId, targetType }) {
  const normalizedTargetId = normalizeTargetId(targetId);
  const normalizedTargetType = normalizeTargetType(targetType);

  const result = await query(
    `INSERT INTO customer_saves (customer_user_id, target_id, target_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (customer_user_id, target_id, target_type)
     DO UPDATE SET saved_at = NOW()
     RETURNING customer_user_id, target_id, target_type, saved_at`,
    [String(customerId), normalizedTargetId, normalizedTargetType]
  );

  return result.rows[0];
}

async function deleteSavedTarget({ customerId, targetId, targetType = null }) {
  const normalizedTargetId = normalizeTargetId(targetId);
  const params = [String(customerId), normalizedTargetId];
  let typeClause = "";

  if (targetType) {
    params.push(normalizeTargetType(targetType));
    typeClause = ` AND target_type = $${params.length}`;
  }

  const result = await query(
    `DELETE FROM customer_saves
     WHERE customer_user_id = $1
       AND target_id = $2${typeClause}`,
    params
  );
  return result.rowCount;
}

async function listSavedTargets(customerId) {
  const result = await query(
    `SELECT cs.*,
            CASE
              WHEN cs.target_type = 'salon' THEN sh.name
              ELSE COALESCE(sp.display_name, 'Stylist')
            END AS name,
            CASE
              WHEN cs.target_type = 'salon' THEN 'Salon'
              ELSE COALESCE(sp.specialties, ss.staff_level, 'Stylist')
            END AS subtitle,
            CASE
              WHEN cs.target_type = 'salon' THEN sh.image_url
              ELSE sp.profile_image_url
            END AS avatar_url,
            COALESCE(sh.address_line1, stylist_shop.address_line1) AS address_line1,
            COALESCE(sh.city, stylist_shop.city) AS city,
            COALESCE(sh.country, stylist_shop.country) AS country,
            stats.rating,
            stats.review_count
     FROM customer_saves cs
     LEFT JOIN shops sh
       ON cs.target_type = 'salon'
      AND cs.target_id = sh.id::text
      AND sh.is_active = true
     LEFT JOIN stylist_profiles sp
       ON cs.target_type = 'stylist'
      AND cs.target_id = sp.user_id::text
      AND sp.is_public = true
     LEFT JOIN shop_staff ss
       ON ss.user_id::text = sp.user_id::text
      AND ss.status = 'active'
     LEFT JOIN shops stylist_shop
       ON stylist_shop.id = ss.shop_id
      AND stylist_shop.is_active = true
     LEFT JOIN LATERAL (
       SELECT ROUND(AVG(sr.rating)::numeric, 1) AS rating,
              COUNT(*)::int AS review_count
       FROM shop_reviews sr
       WHERE sr.is_published = true
         AND (
           (cs.target_type = 'salon' AND sr.shop_id::text = cs.target_id)
           OR
           (cs.target_type = 'stylist' AND sr.stylist_user_id::text = cs.target_id)
         )
     ) stats ON true
     WHERE cs.customer_user_id = $1
       AND (
         (cs.target_type = 'salon' AND sh.id IS NOT NULL)
         OR
         (cs.target_type = 'stylist' AND sp.user_id IS NOT NULL)
       )
     ORDER BY cs.saved_at DESC`,
    [String(customerId)]
  );
  return result.rows.map(rowToSave);
}

module.exports = {
  saveTarget,
  deleteSavedTarget,
  listSavedTargets,
};
