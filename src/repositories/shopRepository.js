const { query } = require("../db/pool");
const crypto = require("crypto");

let shopIdModePromise = null;

async function resolveShopIdMode() {
  if (!shopIdModePromise) {
    shopIdModePromise = query(
      `SELECT data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'shops'
         AND column_name = 'id'
       LIMIT 1`
    ).then((result) => (result.rows[0]?.data_type === "uuid" ? "uuid" : "generated"));
  }
  return shopIdModePromise;
}

function rowToShop(row) {
  if (!row) return null;
  return {
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
    salonCover: {
      url: row.image_url || null,
      publicId: row.image_public_id || null,
    },
    // LEGACY: migrate this field to { url, publicId } object
    imageUrl: row.image_url,
    imagePublicId: row.image_public_id,
    stripeAccountId: row.stripe_account_id || null,
    stripeOnboardingDone: Boolean(row.stripe_onboarding_done),
    payoutsEnabled: Boolean(row.payouts_enabled),
    chargesEnabled: Boolean(row.charges_enabled),
    isActive: row.is_active,
    stylistsCount:
      row.stylists_count === undefined || row.stylists_count === null
        ? undefined
        : Number(row.stylists_count),
    servicesCount:
      row.services_count === undefined || row.services_count === null
        ? undefined
        : Number(row.services_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createShop(shop) {
  const shopIdMode = await resolveShopIdMode();
  const result =
    shopIdMode === "uuid"
      ? await query(
          `INSERT INTO shops (
            id, owner_user_id, name, slug, address_line1, city, country, phone, email, description, image_url, image_public_id
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
          )
          RETURNING *`,
          [
            crypto.randomUUID(),
            shop.ownerUserId,
            shop.name,
            shop.slug,
            shop.addressLine1,
            shop.city,
            shop.country,
            shop.phone,
            shop.email,
            shop.description,
            shop.imageUrl,
            shop.imagePublicId,
          ]
        )
      : await query(
          `INSERT INTO shops (
            owner_user_id, name, slug, address_line1, city, country, phone, email, description, image_url, image_public_id
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
          )
          RETURNING *`,
          [
            shop.ownerUserId,
            shop.name,
            shop.slug,
            shop.addressLine1,
            shop.city,
            shop.country,
            shop.phone,
            shop.email,
            shop.description,
            shop.imageUrl,
            shop.imagePublicId,
          ]
        );
  return rowToShop(result.rows[0]);
}

async function findShopById(id) {
  const result = await query("SELECT * FROM shops WHERE id = $1 LIMIT 1", [id]);
  return rowToShop(result.rows[0]);
}

async function findPublicShopById(id) {
  const result = await query(
    `SELECT s.*,
            (
              SELECT COUNT(*)::int
              FROM shop_staff ss
              WHERE ss.shop_id = s.id
                AND ss.status = 'active'
            ) AS stylists_count,
            (
              SELECT COUNT(*)::int
              FROM shop_services svc
              WHERE svc.shop_id = s.id
                AND svc.is_active = true
            ) AS services_count
     FROM shops s
     WHERE s.id = $1
       AND s.is_active = true
     LIMIT 1`,
    [id]
  );
  return rowToShop(result.rows[0]);
}

async function findActiveShopByOwnerUserId(ownerUserId) {
  const result = await query(
    "SELECT * FROM shops WHERE owner_user_id = $1 AND is_active = true LIMIT 1",
    [ownerUserId]
  );
  return rowToShop(result.rows[0]);
}

async function listShops({ city, q, sort = "newest", limit = 20 }) {
  const filters = ["is_active = true"];
  const params = [];
  const normalizedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 20;
  const sortMap = {
    newest: "s.created_at DESC",
    name_asc: "s.name ASC, s.created_at DESC",
    stylists_desc: "stylists_count DESC, s.created_at DESC",
  };
  const orderBy = sortMap[sort] || sortMap.newest;

  if (city) {
    params.push(city);
    filters.push(`s.city ILIKE $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    filters.push(`(s.name ILIKE $${params.length} OR s.slug ILIKE $${params.length})`);
  }

  params.push(normalizedLimit);

  const result = await query(
    `SELECT s.*,
            (
              SELECT COUNT(*)::int
              FROM shop_staff ss
              WHERE ss.shop_id = s.id
                AND ss.status = 'active'
            ) AS stylists_count,
            (
              SELECT COUNT(*)::int
              FROM shop_services svc
              WHERE svc.shop_id = s.id
                AND svc.is_active = true
            ) AS services_count
     FROM shops s
     WHERE ${filters.join(" AND ")}
     ORDER BY ${orderBy}
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(rowToShop);
}

async function updateShopById(id, patch) {
  const fields = [];
  const params = [];
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    params.push(value);
    fields.push(`${key} = $${params.length}`);
  });
  if (fields.length === 0) return findShopById(id);

  params.push(id);
  const result = await query(
    `UPDATE shops
     SET ${fields.join(", ")}, updated_at = NOW()
     WHERE id = $${params.length}
     RETURNING *`,
    params
  );
  return rowToShop(result.rows[0]);
}

module.exports = {
  createShop,
  findShopById,
  findPublicShopById,
  findActiveShopByOwnerUserId,
  listShops,
  updateShopById,
};
