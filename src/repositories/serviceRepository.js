const { query } = require("../db/pool");
const crypto = require("crypto");
const { getServiceCatalogItem } = require("../catalog/serviceCatalog");

let serviceIdModePromise = null;

async function resolveServiceIdMode() {
  if (!serviceIdModePromise) {
    serviceIdModePromise = query(
      `SELECT data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'shop_services'
         AND column_name = 'id'
       LIMIT 1`
    ).then((result) => (result.rows[0]?.data_type === "uuid" ? "uuid" : "generated"));
  }
  return serviceIdModePromise;
}

function rowToService(row) {
  if (!row) return null;
  const catalogService = row.catalog_service_key ? getServiceCatalogItem(row.catalog_service_key) : null;
  return {
    id: row.id,
    shopId: row.shop_id,
    catalogServiceKey: row.catalog_service_key || null,
    catalogService,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    price: Number(row.price),
    category: row.category,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createService(service) {
  const serviceIdMode = await resolveServiceIdMode();
  const result =
    serviceIdMode === "uuid"
      ? await query(
          `INSERT INTO shop_services (
            id, shop_id, catalog_service_key, name, description, duration_minutes, price, category, is_active
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, true
          ) RETURNING *`,
          [
            crypto.randomUUID(),
            service.shopId,
            service.catalogServiceKey,
            service.name,
            service.description,
            service.durationMinutes,
            service.price,
            service.category,
          ]
        )
      : await query(
          `INSERT INTO shop_services (
            shop_id, catalog_service_key, name, description, duration_minutes, price, category, is_active
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, true
          ) RETURNING *`,
          [
            service.shopId,
            service.catalogServiceKey,
            service.name,
            service.description,
            service.durationMinutes,
            service.price,
            service.category,
          ]
        );
  return rowToService(result.rows[0]);
}

async function findActiveServiceByShopAndCatalogServiceKey(shopId, catalogServiceKey) {
  if (!catalogServiceKey) return null;

  const result = await query(
    `SELECT *
     FROM shop_services
     WHERE shop_id = $1
       AND catalog_service_key = $2
       AND is_active = true
     ORDER BY created_at DESC
     LIMIT 1`,
    [shopId, catalogServiceKey]
  );

  return rowToService(result.rows[0]);
}

async function listServicesByShop(shopId, { includeInactive = false } = {}) {
  const result = await query(
    `SELECT *
     FROM shop_services
     WHERE shop_id = $1 ${includeInactive ? "" : "AND is_active = true"}
     ORDER BY created_at DESC`,
    [shopId]
  );
  return result.rows.map(rowToService);
}

async function findServiceById(serviceId) {
  const result = await query("SELECT * FROM shop_services WHERE id = $1 LIMIT 1", [serviceId]);
  return rowToService(result.rows[0]);
}

async function updateServiceById(id, patch) {
  const fields = [];
  const params = [];
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    params.push(value);
    fields.push(`${key} = $${params.length}`);
  });
  if (fields.length === 0) return findServiceById(id);

  params.push(id);
  const result = await query(
    `UPDATE shop_services
     SET ${fields.join(", ")}, updated_at = NOW()
     WHERE id = $${params.length}
     RETURNING *`,
    params
  );
  return rowToService(result.rows[0]);
}

async function findActiveServiceByShopAndId(shopId, serviceId) {
  const result = await query(
    `SELECT *
     FROM shop_services
     WHERE id = $1
       AND shop_id = $2
       AND is_active = true
     LIMIT 1`,
    [serviceId, shopId]
  );
  return rowToService(result.rows[0]);
}

module.exports = {
  createService,
  findActiveServiceByShopAndCatalogServiceKey,
  listServicesByShop,
  findServiceById,
  findActiveServiceByShopAndId,
  updateServiceById,
};
