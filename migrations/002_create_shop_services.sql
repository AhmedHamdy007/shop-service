CREATE TABLE IF NOT EXISTS shop_services (
  id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id SMALLINT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name VARCHAR(140) NOT NULL,
  description TEXT,
  duration_minutes INT NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  category VARCHAR(80),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_services_shop_id ON shop_services(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_services_is_active ON shop_services(is_active);
