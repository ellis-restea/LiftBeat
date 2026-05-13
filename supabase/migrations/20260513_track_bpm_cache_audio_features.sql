-- Expand track_bpm_cache with all 13 Songstats audio_analysis features
ALTER TABLE track_bpm_cache
  ADD COLUMN IF NOT EXISTS acousticness   float,
  ADD COLUMN IF NOT EXISTS danceability   float,
  ADD COLUMN IF NOT EXISTS duration       float,
  ADD COLUMN IF NOT EXISTS energy         float,
  ADD COLUMN IF NOT EXISTS instrumentalness float,
  ADD COLUMN IF NOT EXISTS key            float,
  ADD COLUMN IF NOT EXISTS liveness       float,
  ADD COLUMN IF NOT EXISTS loudness       float,
  ADD COLUMN IF NOT EXISTS mode           float,
  ADD COLUMN IF NOT EXISTS speechiness    float,
  ADD COLUMN IF NOT EXISTS tempo          float,
  ADD COLUMN IF NOT EXISTS time_signature float,
  ADD COLUMN IF NOT EXISTS valence        float;
