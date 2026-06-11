CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TEMP TABLE ai_style_seed (
  style_rank INT PRIMARY KEY,
  catalog_service_key VARCHAR(120) NOT NULL
) ON COMMIT DROP;

INSERT INTO ai_style_seed (style_rank, catalog_service_key) VALUES
  (1, 'ai-style-textured-crop'),
  (2, 'ai-style-low-taper-fade'),
  (3, 'ai-style-buzz-cut-lineup'),
  (4, 'ai-style-curtain-haircut'),
  (5, 'ai-style-modern-mullet'),
  (6, 'ai-style-slick-back'),
  (7, 'ai-style-curly-top-fade'),
  (8, 'ai-style-bro-flow'),
  (9, 'ai-style-soft-blunt-bob'),
  (10, 'ai-style-long-bob'),
  (11, 'ai-style-butterfly-cut'),
  (12, 'ai-style-bixie-cut'),
  (13, 'ai-style-soft-shag'),
  (14, 'ai-style-wolf-cut'),
  (15, 'ai-style-micro-bob'),
  (16, 'ai-style-birkin-bangs'),
  (17, 'ai-style-midi-cut'),
  (18, 'ai-style-cowboy-bob');

WITH ai_services AS (
  SELECT svc.id AS service_id
  FROM shop_services svc
  INNER JOIN ai_style_seed seed
    ON seed.catalog_service_key = svc.catalog_service_key
)
DELETE FROM stylist_service_offerings offering
USING ai_services
WHERE offering.service_id = ai_services.service_id;

WITH public_staff AS (
  SELECT
    ss.shop_id,
    ss.user_id AS stylist_user_id,
    ss.staff_level,
    ROW_NUMBER() OVER (ORDER BY ss.shop_id, ss.user_id::text) AS stylist_rank
  FROM shop_staff ss
  INNER JOIN shops sh
    ON sh.id = ss.shop_id
   AND sh.is_active = true
  INNER JOIN stylist_profiles sp
    ON sp.user_id = ss.user_id
   AND sp.is_public = true
  WHERE ss.status = 'active'
),
style_count AS (
  SELECT COUNT(*)::int AS total
  FROM ai_style_seed
),
staff_slots AS (
  SELECT
    public_staff.shop_id,
    public_staff.stylist_user_id,
    (((public_staff.stylist_rank - 1) * 3 + slot_index.slot_number) % style_count.total) + 1 AS style_rank
  FROM public_staff
  CROSS JOIN style_count
  CROSS JOIN LATERAL generate_series(
    0,
    CASE WHEN public_staff.staff_level = 'senior_stylist' THEN 3 ELSE 2 END
  ) AS slot_index(slot_number)
),
style_services AS (
  SELECT
    svc.shop_id,
    svc.id AS service_id,
    seed.style_rank
  FROM shop_services svc
  INNER JOIN ai_style_seed seed
    ON seed.catalog_service_key = svc.catalog_service_key
  WHERE svc.is_active = true
),
assignments AS (
  SELECT
    staff_slots.shop_id,
    staff_slots.stylist_user_id,
    style_services.service_id
  FROM staff_slots
  INNER JOIN style_services
    ON style_services.shop_id = staff_slots.shop_id
   AND style_services.style_rank = staff_slots.style_rank
)
INSERT INTO stylist_service_offerings (
  id,
  shop_id,
  stylist_user_id,
  service_id,
  custom_price,
  custom_duration_minutes,
  is_active
)
SELECT
  gen_random_uuid(),
  assignments.shop_id,
  assignments.stylist_user_id,
  assignments.service_id,
  NULL,
  NULL,
  true
FROM assignments
ON CONFLICT (shop_id, stylist_user_id, service_id)
DO UPDATE SET
  is_active = true,
  updated_at = NOW();
