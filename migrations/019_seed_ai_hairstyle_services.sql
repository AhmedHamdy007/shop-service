CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TEMP TABLE ai_style_seed (
  style_rank INT PRIMARY KEY,
  catalog_service_key VARCHAR(120) NOT NULL,
  name VARCHAR(140) NOT NULL,
  description TEXT NOT NULL,
  duration_minutes INT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  category VARCHAR(80) NOT NULL
) ON COMMIT DROP;

INSERT INTO ai_style_seed (
  style_rank,
  catalog_service_key,
  name,
  description,
  duration_minutes,
  price,
  category
) VALUES
  (1, 'ai-style-textured-crop', 'Textured Crop', 'AI recommended style. Also known as French Crop. Adds texture on top; fringe softens sharp features and reduces forehead length.', 45, 75.00, 'AI Recommended'),
  (2, 'ai-style-low-taper-fade', 'Low Taper Fade', 'AI recommended style. Also known as Mid Taper Fade. Clean sides make the face look sharper and more defined.', 45, 65.00, 'AI Recommended'),
  (3, 'ai-style-buzz-cut-lineup', 'Buzz Cut with Line-up', 'AI recommended style. Also known as Buzz Cut. Highlights jawline and bone structure for a sharp, low-maintenance finish.', 40, 55.00, 'AI Recommended'),
  (4, 'ai-style-curtain-haircut', 'Curtain Haircut', 'AI recommended style. Also known as Middle Part Flow. Adds width around the sides and softens long or narrow faces.', 50, 80.00, 'AI Recommended'),
  (5, 'ai-style-modern-mullet', 'Modern Mullet', 'AI recommended style. Also known as Wolf Cut for Men. Adds movement and a fashion-forward statement shape.', 60, 95.00, 'AI Recommended'),
  (6, 'ai-style-slick-back', 'Slick Back', 'AI recommended style. Also known as Wet Look. Strong, polished style that exposes facial structure.', 45, 70.00, 'AI Recommended'),
  (7, 'ai-style-curly-top-fade', 'Curly Top Fade', 'AI recommended style. Also known as Curly Fade. Keeps volume on top while controlling the sides.', 55, 85.00, 'AI Recommended'),
  (8, 'ai-style-bro-flow', 'Bro Flow', 'AI recommended style. Also known as Medium Layered Cut. Natural, relaxed, and suited to longer softer styles.', 60, 90.00, 'AI Recommended'),
  (9, 'ai-style-soft-blunt-bob', 'Soft Blunt Bob', 'AI recommended style. Also known as Blunt Bob. Structured but softer than a sharp bob and adaptable for many looks.', 70, 110.00, 'AI Recommended'),
  (10, 'ai-style-long-bob', 'Long Bob', 'AI recommended style. Also known as Lob. A safe, flattering recommendation for almost every face shape.', 70, 95.00, 'AI Recommended'),
  (11, 'ai-style-butterfly-cut', 'Butterfly Cut', 'AI recommended style. Also known as Face-Framing Layers. Adds volume and soft face-framing movement.', 90, 135.00, 'AI Recommended'),
  (12, 'ai-style-bixie-cut', 'Bixie Cut', 'AI recommended style. Also known as Bob-Pixie. A short, stylish mix of bob and pixie shape.', 75, 120.00, 'AI Recommended'),
  (13, 'ai-style-soft-shag', 'Soft Shag', 'AI recommended style. Also known as Shag Cut. Adds movement and texture while staying customizable.', 80, 125.00, 'AI Recommended'),
  (14, 'ai-style-wolf-cut', 'Wolf Cut', 'AI recommended style. Also known as Layered Wolf. Edgy and layered with volume on top and personality throughout.', 85, 130.00, 'AI Recommended'),
  (15, 'ai-style-micro-bob', 'Micro Bob', 'AI recommended style. Also known as Short Bob. Highlights cheekbones and jawline for balanced features.', 65, 105.00, 'AI Recommended'),
  (16, 'ai-style-birkin-bangs', 'Birkin Bangs', 'AI recommended style. Also known as Soft Fringe. Softens forehead and balances longer faces.', 60, 90.00, 'AI Recommended'),
  (17, 'ai-style-midi-cut', 'Midi Cut', 'AI recommended style. Also known as Medium Layers. Low-risk, low-maintenance, and suitable for many clients.', 75, 115.00, 'AI Recommended'),
  (18, 'ai-style-cowboy-bob', 'Cowboy Bob', 'AI recommended style. Also known as Textured Bob. Textured bob with movement and adjustable length.', 75, 120.00, 'AI Recommended');

DO $$
DECLARE
  service_id_type TEXT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
  INTO service_id_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'shop_services'
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF service_id_type = 'uuid' THEN
    INSERT INTO shop_services (
      id,
      shop_id,
      catalog_service_key,
      name,
      description,
      duration_minutes,
      price,
      category,
      is_active
    )
    SELECT
      gen_random_uuid(),
      sh.id,
      seed.catalog_service_key,
      seed.name,
      seed.description,
      seed.duration_minutes,
      seed.price,
      seed.category,
      true
    FROM shops sh
    CROSS JOIN ai_style_seed seed
    WHERE sh.is_active = true
      AND NOT EXISTS (
        SELECT 1
        FROM shop_services svc
        WHERE svc.shop_id = sh.id
          AND svc.catalog_service_key = seed.catalog_service_key
      );
  ELSE
    INSERT INTO shop_services (
      shop_id,
      catalog_service_key,
      name,
      description,
      duration_minutes,
      price,
      category,
      is_active
    )
    SELECT
      sh.id,
      seed.catalog_service_key,
      seed.name,
      seed.description,
      seed.duration_minutes,
      seed.price,
      seed.category,
      true
    FROM shops sh
    CROSS JOIN ai_style_seed seed
    WHERE sh.is_active = true
      AND NOT EXISTS (
        SELECT 1
        FROM shop_services svc
        WHERE svc.shop_id = sh.id
          AND svc.catalog_service_key = seed.catalog_service_key
      );
  END IF;
END $$;

UPDATE shop_services svc
SET name = seed.name,
    description = seed.description,
    duration_minutes = seed.duration_minutes,
    price = seed.price,
    category = seed.category,
    is_active = true,
    updated_at = NOW()
FROM ai_style_seed seed
WHERE svc.catalog_service_key = seed.catalog_service_key;

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
