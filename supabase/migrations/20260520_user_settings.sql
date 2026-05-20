-- Per-user app preferences (DJ mode, future settings)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id   text PRIMARY KEY,
  dj_mode   text NOT NULL DEFAULT 'responsive',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
