-- BPM cache keyed by Spotify track ID. No user-specific data — shared across all users.
create table if not exists track_bpm_cache (
  spotify_track_id text primary key,
  bpm             numeric,          -- null means Songstats returned no BPM for this track
  cached_at       timestamptz default now()
);

-- Allow anonymous reads and writes (BPM cache contains no personal data)
alter table track_bpm_cache enable row level security;

create policy "Public read"   on track_bpm_cache for select using (true);
create policy "Public insert" on track_bpm_cache for insert with check (true);
create policy "Public update" on track_bpm_cache for update using (true);
