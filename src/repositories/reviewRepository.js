const crypto = require("crypto");
const { query } = require("../db/pool");

function rowToReview(row) {
  if (!row) return null;
  return {
    id: row.id,
    shopId: row.shop_id,
    stylistUserId: row.stylist_user_id,
    customerUserId: row.customer_user_id,
    bookingId: row.booking_id,
    serviceName: row.service_name,
    rating: Number(row.rating),
    aspectRatings: {
      technique: row.technique_rating === null ? null : Number(row.technique_rating),
      communication:
        row.communication_rating === null ? null : Number(row.communication_rating),
      value: row.value_rating === null ? null : Number(row.value_rating),
      atmosphere: row.atmosphere_rating === null ? null : Number(row.atmosphere_rating),
    },
    reviewText: row.review_text,
    photoUrls: Array.isArray(row.photo_urls) ? row.photo_urls : [],
    isPublished: row.is_published,
    salonName: row.salon_name,
    salonAvatar: row.salon_avatar,
    stylistName: row.stylist_name,
    stylistAvatar: row.stylist_avatar,
    bookingDate: row.booking_date || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeLimit(limit, fallback = 20) {
  return Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : fallback;
}

async function listReviewsByShop(shopId, { limit = 20, includeUnpublished = false } = {}) {
  const params = [shopId, normalizeLimit(limit)];
  const publishedClause = includeUnpublished ? "" : "AND is_published = true";
  const result = await query(
    `SELECT *
     FROM shop_reviews
     WHERE shop_id = $1
       ${publishedClause}
     ORDER BY created_at DESC
     LIMIT $2`,
    params
  );
  return result.rows.map(rowToReview);
}

async function listReviewsByStylist(stylistUserId, { limit = 20 } = {}) {
  const result = await query(
    `SELECT *
     FROM shop_reviews
     WHERE stylist_user_id = $1
       AND is_published = true
     ORDER BY created_at DESC
     LIMIT $2`,
    [stylistUserId, normalizeLimit(limit)]
  );
  return result.rows.map(rowToReview);
}

async function listReviewsByCustomer(customerUserId, { limit = 50 } = {}) {
  const result = await query(
    `SELECT sr.*,
            sh.name AS salon_name,
            sh.image_url AS salon_avatar,
            sp.display_name AS stylist_name,
            sp.profile_image_url AS stylist_avatar
     FROM shop_reviews sr
     LEFT JOIN shops sh ON sh.id = sr.shop_id
     LEFT JOIN stylist_profiles sp ON sp.user_id::text = sr.stylist_user_id::text
     WHERE sr.customer_user_id = $1
     ORDER BY sr.created_at DESC
     LIMIT $2`,
    [customerUserId, normalizeLimit(limit, 50)]
  );
  return result.rows.map(rowToReview);
}

async function findReviewByBookingId(bookingId) {
  const result = await query("SELECT * FROM shop_reviews WHERE booking_id = $1 LIMIT 1", [
    bookingId,
  ]);
  return rowToReview(result.rows[0]);
}

async function createReview({
  shopId,
  stylistUserId = null,
  customerUserId,
  bookingId,
  serviceName = null,
  rating,
  aspectRatings = {},
  reviewText,
  photoUrls = [],
}) {
  const result = await query(
    `INSERT INTO shop_reviews (
      id,
      shop_id,
      stylist_user_id,
      customer_user_id,
      booking_id,
      service_name,
      rating,
      technique_rating,
      communication_rating,
      value_rating,
      atmosphere_rating,
      review_text,
      photo_urls
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
    )
    RETURNING *`,
    [
      crypto.randomUUID(),
      shopId,
      stylistUserId,
      customerUserId,
      bookingId,
      serviceName,
      rating,
      aspectRatings.technique || null,
      aspectRatings.communication || null,
      aspectRatings.value || null,
      aspectRatings.atmosphere || null,
      reviewText,
      JSON.stringify(photoUrls),
    ]
  );
  return rowToReview(result.rows[0]);
}

module.exports = {
  createReview,
  findReviewByBookingId,
  listReviewsByCustomer,
  listReviewsByShop,
  listReviewsByStylist,
};
