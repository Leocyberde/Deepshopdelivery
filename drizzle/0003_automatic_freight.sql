-- Non-destructive; safe to run repeatedly. Historical tickets and manual fees remain untouched.
CREATE TABLE IF NOT EXISTS geo_distance_cache (
  cache_key TEXT PRIMARY KEY, origin_text TEXT NOT NULL, destination_text TEXT NOT NULL,
  distance_meters INTEGER NOT NULL CHECK (distance_meters >= 0), duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  provider TEXT NOT NULL, hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS geo_api_usage (month TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0));
CREATE TABLE IF NOT EXISTS geo_lookup_log (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMP NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_geo_lookup_user_created ON geo_lookup_log(user_id, created_at);
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS delivery_cache_key TEXT;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS delivery_in_area BOOLEAN;
CREATE TABLE IF NOT EXISTS freight_legacy_runs (
  id TEXT PRIMARY KEY, actor_user_id INTEGER REFERENCES users(id), plan JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(), executed_at TIMESTAMP, result JSONB
);
INSERT INTO settings (key, value) VALUES
 ('freight_free_band1_enabled','false'), ('freight_free_band1_min_required','false'), ('freight_free_band1_min_value','0'),
 ('freight_free_band2_enabled','false'), ('freight_free_band2_min_value','90'),
 ('geo_monthly_limit','35000'), ('geo_warn_at','25000'), ('freight_max_km','20'), ('freight_out_of_area_whatsapp','11910509385')
ON CONFLICT (key) DO NOTHING;
