@AGENTS.md


LiftSync — Project Summary & Handoff
What is LiftSync:
A web app that controls the user's Spotify playback during gym workouts. High BPM songs play during sets, low BPM songs play during rest periods. Automatically switches based on a workout timer. Built with Next.js, Supabase, and Spotify API.
Tech Stack:

Next.js 16 (App Router, TypeScript, Tailwind v4)
Supabase (database)
NextAuth v4 (Spotify OAuth)
Spotify Web API (playback control, BPM data)
Running locally on http://127.0.0.1:3000

Current File Structure:
app/
  page.tsx              — Landing page (Get Started / Log In)
  layout.tsx            — Root layout with SessionProvider
  providers.tsx         — Client-side SessionProvider wrapper
  globals.css           — Tailwind imports + .skeleton shimmer + tabEnter + swish-border animations
  onboarding/page.tsx   — 3 slide onboarding for new users
  dashboard/page.tsx    — Thin AppShell wrapper (initialTab="home")
  stats/page.tsx        — Thin AppShell wrapper (initialTab="stats")
  settings/page.tsx     — Thin AppShell wrapper (initialTab="settings")
  playlist-select/page.tsx — One-time onboarding playlist selection (no bottom nav)
  workout-setup/page.tsx   — Build workout (exercises, sets, reps, rest)
  workout/page.tsx         — Main workout screen
  api/auth/[...nextauth]/route.js — Spotify OAuth + token refresh
  api/playlist-bpm/route.ts — Server route: Songstats BPM lookup + Supabase caching
  api/songstats/track/route.ts — Debug route: single-track Songstats lookup
  components/
    AppShell.tsx        — SPA shell: manages tab state, persistent mounts, auth redirect, playlist check
    BottomNav.tsx       — Floating frosted-glass pill nav (320px, blur backdrop), sliding pill indicator
    LoadingScreen.tsx   — Morphing star frames (✦✧✸✹✺…) cycling at 150ms, rotating messages
    tabs/
      HomeTab.tsx       — Saved workouts list with shimmer skeleton rows
      MusicTab.tsx      — Playlist selector with shimmer skeleton rows, pre-loads saved IDs
      StatsTab.tsx      — Stats (coming soon)
      SettingsTab.tsx   — Sound + haptic toggles, persisted to localStorage
lib/
  supabase.ts           — Supabase client
  feedback.ts           — Sound (Web Audio API) + haptic (navigator.vibrate) feedback system
  prefetchBpm.ts        — Fire-and-forget BPM prefetch after playlist save (called from MusicTab + playlist-select)
types/
  next-auth.d.ts        — Session type extensions
Environment Variables (.env.local):
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://127.0.0.1:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SONGSTATS_API_KEY=
NEXT_PUBLIC_GETSONGBPM_KEY=   ← present but not currently used in code
Spotify App Settings:

Redirect URI: http://127.0.0.1:3000/api/auth/callback/spotify
Scopes: user-read-private user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative streaming

Supabase Tables:
workouts: id, user_id, name, created_at
exercises: id, workout_id, name, sets, reps, rest_seconds, order_index, superset_with
user_playlists: id, user_id, playlist_ids (text array), created_at
track_bpm_cache: spotify_track_id, bpm, cached_at, acousticness, danceability, duration, energy,
  instrumentalness, key, liveness, loudness, mode, speechiness, tempo, time_signature, valence

IMPORTANT — Supabase migration required (run in SQL Editor if not done):
  supabase/migrations/20260513_track_bpm_cache_fix_schema.sql
  Adds all 13 audio feature columns + deletes null-bpm rows so they get re-fetched.

User Flows:
New user:
Landing page → Onboarding (3 slides) → Spotify login → Playlist select (saved to Supabase) → Workout setup → Workout screen
Returning user:
Landing page (detects session) → Logo/loading screen → Dashboard (saved workouts list + pencil icon to edit playlists) → Tap workout → Workout screen
Important flow notes:

Playlist select is ONE TIME during onboarding only
After onboarding, selected playlists are saved in Supabase under user_playlists table
Dashboard has a small pencil/edit icon that takes user back to playlist-select to update their saved playlists
Workout screen loads playlists from Supabase, not from URL params
No payment screen for now — launch free to build user base, add subscription later once traction is gained

App Logic — Playback System (current: Option 2 custom queue):

On workout start: pull all tracks from all selected playlists (client-side Spotify fetch),
  POST to /api/playlist-bpm for BPM lookup, build trackPool (flat TrackBpm[] with playlistId + bpm).
buildQueue(state, pool, excludeIds, count=10): filters by BPM bucket (HIGH ≥120 for warmup/exercise,
  LOW <120 for rest), excludes played tracks, round-robin distributes across playlists, returns URIs.
playForState(state): calls buildQueue + PUT /me/player/play with uris array — never uses context_uri.
  State changes (Done with Set, rest timer end) call playForState directly with 500ms delay.
Queue refill: fetchCurrentTrack detects when <5 tracks remain, calls PUT /play with offset+position_ms
  to extend queue seamlessly without interrupting current song.
playedIdsRef: Set of track IDs already played this workout — passed to buildQueue as excludeIds.
deviceIdRef: cached on Start Workout, lazily resolved in playForState if null.
loadedPlaylistIdsRef: sorted playlist ID string — prevents redundant preloads on same selection.
BPM cutoff: 120. ≥120 = HIGH (exercising/warmup), <120 = LOW (resting).
Workout states: idle → warmup → exercising → resting → done
Glow overlays: amber (warmup), red (exercising), blue (resting), emerald (done)
Rest timer counts down, auto-switches to exercising + calls playForState("exercising") when done.
noDevice banner only shown in idle state — 204 from currently-playing during active workout is ignored.
Spotify scopes: user-read-private user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative streaming
show_dialog: true on Spotify OAuth to always force consent screen

BPM Source:
Primary: Songstats Enterprise API — GET /enterprise/v1/tracks/info?spotify_track_id={id}
  Returns audio_analysis array of {key, value} strings. extractFeatures() parses all 13 keys.
  API key: SONGSTATS_API_KEY env var (server-side only)
  Logs all 13 features per track in server console when found.
  Coverage gap: poor on regional/niche music (Romanian, etc.) — returns tempo: null for those tracks.
Fallback: none currently — tracks with no Songstats data go to unknown bucket and are excluded from queue.
Caching: Supabase track_bpm_cache table. Only caches rows where features !== null.
  Null-bpm rows in cache are ignored on read so they get re-fetched.
  Schema fix migration must be run (see above).

BPM Prefetch: lib/prefetchBpm.ts — called fire-and-forget after playlist save in MusicTab and playlist-select.
  Fetches all playlist tracks from Spotify, POSTs to /api/playlist-bpm to warm the cache.


Known Issues / Blockers:

*** ACTIVE BLOCKER: 403 on GET /playlists/{id}/tracks ***
The client-side Spotify fetch for playlist tracks returns 403 even after sign-out/sign-in.
Code is correct (playlist-read-private is in auth config scopes on both initial auth and refresh).
Root cause: unclear — token may not be receiving the scope despite re-auth.
Pool stays at 0 → buildQueue returns empty → workout falls back to resuming whatever Spotify had playing.

Possible fixes to try next session (in order):
1. Revoke app access from Spotify account settings (spotify.com/account/apps) then re-authenticate —
   this forces a completely fresh OAuth grant, not just a NextAuth signout.
2. Decode the current access token (paste into jwt.io) and check the `scope` claim to confirm
   whether playlist-read-private is actually present in the issued token.
3. Move playlist track fetching to server-side (new API route uses session token server-side) —
   avoids any client-side CORS or scope-delivery issue.
4. Check if the specific playlist (2j8uGNFE19P4QbX88pr2hD) is private vs. public — try selecting
   a known public playlist to isolate whether it's a scope issue or a playlist-ownership issue.
5. Check Spotify Developer Dashboard app settings — confirm the redirect URI and scopes match exactly.
6. The PUT /me/player/play 403 (second error) will resolve once the first is fixed and the queue
   is non-empty. It may also indicate user-modify-playback-state is missing from the token.

Upcoming Features (in priority order):

BPM coverage for regional music (Songstats gap) — investigate alternative BPM sources or manual BPM entry
BPM variety scanner — warn user if playlist lacks variety, recommend adding more
Adaptive mode — user manually taps to switch high/low BPM, app learns timing over sessions
Subscription payment (Stripe) — add after gaining traction, not at launch
Heart rate mode (smartwatch integration) — v3 feature

Monetization Plan:

Launch completely free to build user base
Add monthly subscription once meaningful traction is gained
Early users may get founding member discount or stay free forever
Ad supported free tier (TBD)

App Name: LiftSync
Design Language:

Dark base: bg-[#0a0a0f] (very dark navy-black)
Electric blue (#3b82f6) as primary accent
card-metallic CSS utility: gradient surface + border + shadow
State-based radial glow overlays on workout screen (amber/red/blue/emerald), 700ms opacity transition
Primary buttons: solid blue, white text, active:scale-95
Secondary buttons: transparent with blue outline, active:scale-95
Swish border animation: CSS @property --swish-angle conic-gradient sweeping on all CTA buttons
Bottom nav: floating frosted-glass pill (320px, border-radius 9999, blur(20px) backdrop)
All tabs permanently mounted in AppShell (display:block/none) — no remounting, no loading flicker
Shimmer skeleton states in HomeTab and MusicTab while data loads
Tailwind v4 for styling
Clean, minimal gym aesthetic

User Identity:

No email returned in Spotify session — using session.user.name as user_id in Supabase

GitHub repo: https://github.com/babacaca123/LiftSync


Sound & Haptic Feedback (lib/feedback.ts):

sound(type): Web Audio API sine oscillator with linear ramp fade-out (no click artifact). light=800hz/12ms, medium=600hz/18ms, heavy=400hz/25ms, error=two 300hz pulses.
haptic(type): navigator.vibrate() — light=10ms, medium=15ms, heavy=30ms, error=[50,50,50]. No-ops silently on iOS.
feedback(type): calls both. Checks localStorage ls_sound / ls_haptic (default on).
Guards: (1) input focus guard — skips all feedback when an <input>/<textarea> is focused; (2) 80ms dedup window per type — prevents doubled sounds from rapid taps; (3) 150ms minimum gap between any two sounds — prevents browser audio suppression from silencing bursts.
AudioContext resume is properly awaited before scheduling oscillators.
Wired up: BottomNav tabs (light), workout-setup steppers/add/superset (light), save (medium), MusicTab tap/save (medium), HomeTab delete/confirm/cancel (medium/medium/light), Start Workout/Start Set/Done with Set (heavy).
Settings toggles in SettingsTab persist to ls_sound / ls_haptic.


Additional context:

Do not ask me technical questions, make the best decisions for a clean gym app
Color scheme: dark/moody base (bg-[#0a0a0f]), electric blue (#3b82f6) accent, state glow overlays on workout screen
Done state: emerald glow + emerald button
Exercising transition: 300ms (punchy), Resting transition: 700ms (slow calm fade)
Full screen color wash transitions (radial glow overlays, not background-color swap)

commit everything to GitHub with a descriptive message

when to commit: Unit of Work: When you finish a single function, fix a bug, or complete a specific subtask. Working State: Every time your code is in a stable, buildable state. Before Risky Changes: Just before you attempt a major refactor or "try something out" that might break things. End of Session: At least once per day to ensure your local progress is backed up.
