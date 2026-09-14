CREATE TABLE tracker_profile (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  display_name VARCHAR(100) NOT NULL DEFAULT 'Personal user',
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tracker_profile_singleton CHECK (id = 1),
  CONSTRAINT tracker_profile_display_name_nonblank
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
  CONSTRAINT tracker_profile_timezone_nonblank
    CHECK (char_length(btrim(timezone)) BETWEEN 1 AND 64)
);

CREATE TABLE goals (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  daily_calories_kcal NUMERIC(12,4) DEFAULT NULL,
  daily_protein_g NUMERIC(12,4) DEFAULT NULL,
  daily_carbs_g NUMERIC(12,4) DEFAULT NULL,
  daily_fat_g NUMERIC(12,4) DEFAULT NULL,
  target_weight_kg NUMERIC(12,4) DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT goals_singleton CHECK (id = 1),
  CONSTRAINT goals_daily_calories_bounds CHECK (
    daily_calories_kcal IS NULL OR
    (daily_calories_kcal > 0 AND daily_calories_kcal <= 1000000)
  ),
  CONSTRAINT goals_daily_protein_bounds CHECK (
    daily_protein_g IS NULL OR
    (daily_protein_g >= 0 AND daily_protein_g <= 1000000)
  ),
  CONSTRAINT goals_daily_carbs_bounds CHECK (
    daily_carbs_g IS NULL OR
    (daily_carbs_g >= 0 AND daily_carbs_g <= 1000000)
  ),
  CONSTRAINT goals_daily_fat_bounds CHECK (
    daily_fat_g IS NULL OR
    (daily_fat_g >= 0 AND daily_fat_g <= 1000000)
  ),
  CONSTRAINT goals_target_weight_bounds CHECK (
    target_weight_kg IS NULL OR
    (target_weight_kg > 0 AND target_weight_kg <= 1000000)
  )
);

CREATE TABLE meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_name VARCHAR(200) NOT NULL,
  meal_type VARCHAR(10) NOT NULL,
  consumption_date DATE NOT NULL,
  consumed_quantity NUMERIC(12,4) NOT NULL,
  quantity_unit VARCHAR(10) NOT NULL,
  calories_kcal NUMERIC(12,4) NOT NULL,
  protein_g NUMERIC(12,4) NOT NULL,
  carbs_g NUMERIC(12,4) NOT NULL,
  fat_g NUMERIC(12,4) NOT NULL,
  sodium_mg NUMERIC(12,4) DEFAULT NULL,
  calcium_mg NUMERIC(12,4) DEFAULT NULL,
  iron_mg NUMERIC(12,4) DEFAULT NULL,
  potassium_mg NUMERIC(12,4) DEFAULT NULL,
  vitamin_c_mg NUMERIC(12,4) DEFAULT NULL,
  vitamin_d_mcg NUMERIC(12,4) DEFAULT NULL,
  entry_source VARCHAR(20) NOT NULL DEFAULT 'manual',
  is_estimate BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meals_food_name_nonblank
    CHECK (char_length(btrim(food_name)) BETWEEN 1 AND 200),
  CONSTRAINT meals_meal_type_allowed
    CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snacks')),
  CONSTRAINT meals_consumption_date_supported
    CHECK (consumption_date BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'),
  CONSTRAINT meals_consumed_quantity_bounds
    CHECK (consumed_quantity > 0 AND consumed_quantity <= 1000000),
  CONSTRAINT meals_quantity_unit_allowed
    CHECK (quantity_unit IN ('g', 'ml', 'serving', 'piece')),
  CONSTRAINT meals_calories_bounds
    CHECK (calories_kcal >= 0 AND calories_kcal <= 1000000),
  CONSTRAINT meals_protein_bounds
    CHECK (protein_g >= 0 AND protein_g <= 1000000),
  CONSTRAINT meals_carbs_bounds
    CHECK (carbs_g >= 0 AND carbs_g <= 1000000),
  CONSTRAINT meals_fat_bounds
    CHECK (fat_g >= 0 AND fat_g <= 1000000),
  CONSTRAINT meals_sodium_bounds
    CHECK (sodium_mg IS NULL OR (sodium_mg >= 0 AND sodium_mg <= 1000000)),
  CONSTRAINT meals_calcium_bounds
    CHECK (calcium_mg IS NULL OR (calcium_mg >= 0 AND calcium_mg <= 1000000)),
  CONSTRAINT meals_iron_bounds
    CHECK (iron_mg IS NULL OR (iron_mg >= 0 AND iron_mg <= 1000000)),
  CONSTRAINT meals_potassium_bounds
    CHECK (potassium_mg IS NULL OR (potassium_mg >= 0 AND potassium_mg <= 1000000)),
  CONSTRAINT meals_vitamin_c_bounds
    CHECK (vitamin_c_mg IS NULL OR (vitamin_c_mg >= 0 AND vitamin_c_mg <= 1000000)),
  CONSTRAINT meals_vitamin_d_bounds
    CHECK (vitamin_d_mcg IS NULL OR (vitamin_d_mcg >= 0 AND vitamin_d_mcg <= 1000000)),
  CONSTRAINT meals_entry_source_allowed
    CHECK (entry_source IN ('manual', 'nutrition_label', 'food_plate')),
  CONSTRAINT meals_food_plate_is_estimate
    CHECK (entry_source <> 'food_plate' OR is_estimate)
);

CREATE INDEX meals_consumption_order_idx
  ON meals (consumption_date DESC, created_at DESC, id DESC);

CREATE INDEX meals_type_consumption_order_idx
  ON meals (meal_type, consumption_date DESC, created_at DESC, id DESC);

INSERT INTO tracker_profile (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO goals (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
