CREATE TABLE IF NOT EXISTS customer_saves (
  customer_user_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('stylist', 'salon')),
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_user_id, target_id, target_type)
);

CREATE INDEX IF NOT EXISTS idx_customer_saves_customer_saved_at
ON customer_saves(customer_user_id, saved_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_saves_target
ON customer_saves(target_type, target_id);
