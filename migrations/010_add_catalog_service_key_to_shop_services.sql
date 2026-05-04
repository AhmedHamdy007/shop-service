ALTER TABLE shop_services
ADD COLUMN IF NOT EXISTS catalog_service_key VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_shop_services_catalog_service_key
ON shop_services(catalog_service_key);
