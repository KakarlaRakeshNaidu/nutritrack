CREATE TABLE nutritrack_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT DEFAULT NULL,
  is_legacy BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_nonblank CHECK (char_length(btrim(email_normalized)) BETWEEN 3 AND 254),
  CONSTRAINT users_login_credentials CHECK (is_legacy OR password_hash IS NOT NULL)
);

INSERT INTO nutritrack_users (id, email_normalized, password_hash, is_legacy)
VALUES ('00000000-0000-4000-8000-000000000001', 'legacy-owner@invalid.local', NULL, true);

ALTER TABLE tracker_profile DROP CONSTRAINT tracker_profile_singleton;
ALTER TABLE tracker_profile DROP CONSTRAINT tracker_profile_pkey;
ALTER TABLE tracker_profile ADD COLUMN user_id UUID;
UPDATE tracker_profile SET user_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE tracker_profile ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE tracker_profile ADD CONSTRAINT tracker_profile_user_fk
  FOREIGN KEY (user_id) REFERENCES nutritrack_users(id) ON DELETE CASCADE;
ALTER TABLE tracker_profile DROP COLUMN id;
ALTER TABLE tracker_profile ADD PRIMARY KEY (user_id);

ALTER TABLE goals DROP CONSTRAINT goals_singleton;
ALTER TABLE goals DROP CONSTRAINT goals_pkey;
ALTER TABLE goals ADD COLUMN user_id UUID;
UPDATE goals SET user_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE goals ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE goals ADD CONSTRAINT goals_user_fk
  FOREIGN KEY (user_id) REFERENCES nutritrack_users(id) ON DELETE CASCADE;
ALTER TABLE goals DROP COLUMN id;
ALTER TABLE goals ADD PRIMARY KEY (user_id);

ALTER TABLE meals ADD COLUMN user_id UUID;
UPDATE meals SET user_id = '00000000-0000-4000-8000-000000000001';
ALTER TABLE meals ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE meals ADD CONSTRAINT meals_user_fk
  FOREIGN KEY (user_id) REFERENCES nutritrack_users(id) ON DELETE CASCADE;
CREATE INDEX meals_user_consumption_order_idx
  ON meals (user_id, consumption_date DESC, created_at DESC, id DESC);
CREATE INDEX meals_user_type_consumption_order_idx
  ON meals (user_id, meal_type, consumption_date DESC, created_at DESC, id DESC);

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES nutritrack_users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_active_user_idx
  ON auth_sessions (user_id, expires_at) WHERE revoked_at IS NULL;
