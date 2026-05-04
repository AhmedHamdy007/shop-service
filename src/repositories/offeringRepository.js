const { query } = require("../db/pool");
const crypto = require("crypto");

function rowToOffering(row) {
  if (!row) return null;
  return {
    id: row.id,
    shopId: row.shop_id,
    stylistUserId: row.stylist_user_id,
    serviceId: row.service_id,
    customPrice: row.custom_price === null ? null : Number(row.custom_price),
    customDurationMinutes: row.custom_duration_minutes,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function upsertOffering({
  shopId,
  stylistUserId,
  serviceId,
  customPrice = null,
  customDurationMinutes = null,
  isActive = true,
}) {
  const result = await query(
    `INSERT INTO stylist_service_offerings (
      id, shop_id, stylist_user_id, service_id, custom_price, custom_duration_minutes, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (shop_id, stylist_user_id, service_id)
    DO UPDATE SET
      custom_price = EXCLUDED.custom_price,
      custom_duration_minutes = EXCLUDED.custom_duration_minutes,
      is_active = EXCLUDED.is_active,
      updated_at = NOW()
    RETURNING *`,
    [crypto.randomUUID(), shopId, stylistUserId, serviceId, customPrice, customDurationMinutes, isActive]
  );
  return rowToOffering(result.rows[0]);
}

async function listByShopAndStylist(shopId, stylistUserId) {
  const result = await query(
    `SELECT o.*,
            s.name AS service_name,
            s.description AS service_description,
            s.duration_minutes AS service_duration_minutes,
            s.price AS service_price,
            s.category AS service_category
     FROM stylist_service_offerings o
     INNER JOIN shop_services s ON s.id = o.service_id
     WHERE o.shop_id = $1
       AND o.stylist_user_id = $2
       AND o.is_active = true
       AND s.is_active = true
     ORDER BY s.name ASC`,
    [shopId, stylistUserId]
  );

  return result.rows.map((row) => ({
    ...rowToOffering(row),
      service: {
        id: row.service_id,
        name: row.service_name,
        description: row.service_description,
        durationMinutes: row.service_duration_minutes,
        price: Number(row.service_price),
        category: row.service_category,
    },
  }));
}

async function findActiveOfferingByShopStylistAndService(shopId, stylistUserId, serviceId) {
  const result = await query(
    `SELECT o.*,
            s.name AS service_name,
            s.description AS service_description,
            s.duration_minutes AS service_duration_minutes,
            s.price AS service_price,
            s.category AS service_category,
            s.catalog_service_key AS service_catalog_service_key
     FROM stylist_service_offerings o
     INNER JOIN shop_services s ON s.id = o.service_id
     WHERE o.shop_id = $1
       AND o.stylist_user_id = $2
       AND o.service_id = $3
       AND o.is_active = true
       AND s.is_active = true
     LIMIT 1`,
    [shopId, stylistUserId, serviceId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    ...rowToOffering(row),
      service: {
        id: row.service_id,
        catalogServiceKey: row.service_catalog_service_key || null,
        name: row.service_name,
        description: row.service_description,
        durationMinutes: row.service_duration_minutes,
      price: Number(row.service_price),
      category: row.service_category,
    },
  };
}

async function deactivate(shopId, stylistUserId, serviceId) {
  const result = await query(
    `UPDATE stylist_service_offerings
     SET is_active = false, updated_at = NOW()
     WHERE shop_id = $1
       AND stylist_user_id = $2
       AND service_id = $3
     RETURNING *`,
    [shopId, stylistUserId, serviceId]
  );
  return rowToOffering(result.rows[0]);
}

module.exports = {
  upsertOffering,
  listByShopAndStylist,
  findActiveOfferingByShopStylistAndService,
  deactivate,
};
