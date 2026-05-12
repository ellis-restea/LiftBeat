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
  globals.css           — Tailwind imports
  onboarding/page.tsx   — 3 slide onboarding for new users
  dashboard/page.tsx    — Returning user dashboard (saved workouts list)
  playlist-select/page.tsx — One-time onboarding playlist selection
  workout-setup/page.tsx   — Build workout (exercises, sets, reps, rest)
  workout/page.tsx         — Main workout screen
  api/auth/[...nextauth]/route.js — Spotify OAuth + token refresh
lib/
  supabase.ts           — Supabase client
types/
  next-auth.d.ts        — Session type extensions
Environment Variables (.env.local):
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://127.0.0.1:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
Spotify App Settings:

Redirect URI: http://127.0.0.1:3000/api/auth/callback/spotify
Scopes: user-read-private user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative streaming

Supabase Tables:
sqlworkouts: id, user_id, name, created_at
exercises: id, workout_id, name, sets, reps, rest_seconds, order_index, superset_with

-- NEEDS TO BE ADDED:
user_playlists: id, user_id, playlist_ids (text array), created_at
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

App Logic:

Spotify token auto-refreshes via NextAuth JWT callback
Playlists fetched from Spotify, user selects one or more, saved to Supabase
BPM detection: queue-based, no pre-loading. On state change, fetches currently-playing, looks up BPM, skips forward up to 5x until energy matches.
BPM source priority: ReccoBeats → GetSongBPM → skip.
  - ReccoBeats: GET /v1/track?ids={spotifyId} → UUID → GET /v1/track/{uuid}/audio-features → tempo
  - GetSongBPM: GET https://api.getsong.co/search/?api_key={key}&type=song&lookup={trackName}
      Step 1: search full track name, require confirmed artist match (bidirectional partial, case-insensitive)
      Step 2: if no match, strip dash/paren suffixes (e.g. "Dakota - Decade In The Sun Version" → "Dakota") and retry
      API key: NEXT_PUBLIC_GETSONGBPM_KEY env var
      Artist field in API response varies — code tries: artist.title, artist.name, artist_name, artist (string)
      Result only accepted if artist name is confirmed — never uses unverified first-result fallback
Fixed BPM cutoff: 120 BPM. ≥120 = HIGH (exercising/warmup), <120 = LOW (resting).
Tracks not found in either API are skipped (not accepted as unknown energy).
BPM results cached in-memory (bpmCacheRef: Map<string, number|null>) for the session.
BPM source cached in-memory (bpmSourceCacheRef: Map<string, string>) — values: 'ReccoBeats', 'GetSongBPM', 'unknown'.
On track change: pre-warms BPM cache for next 6 tracks in queue (fire-and-forget).
Queue analysis log includes: { name, bpm, category, api } — api shows which source found the BPM.
Workout screen has 4 states: idle → warmup → exercising → resting
Background color changes per state: dark (idle), amber (warmup), red (exercising), blue (resting)
Rest timer counts down, auto-switches back to exercising when done
Song progress bar polls Spotify every second
Manual skip (⏭) triggers BPM check after 800ms — steers to correct energy for current state
State change (Done with Set → resting): 500ms delay before BPM check so Spotify settles first
Start Workout: 500ms delay before ensureTrackEnergy so Spotify registers the play command first
noDevice banner only shown in idle state — 204 from currently-playing during active workout is ignored
Spotify scopes: user-read-private user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative streaming
show_dialog: true on Spotify OAuth to always force consent screen (ensures latest scopes)
GetSongBPM attribution footer present in: layout.tsx (server-rendered), dashboard, landing page, workout page


Known Issues / Limitations:

ReccoBeats has poor coverage of obscure/slowed/lo-fi tracks — falls through to GetSongBPM
GetSongBPM artist field structure varies per response; code tries multiple field names
user_playlists table in Supabase still needs to be created if not done yet (see table schema above)


Upcoming Features (in priority order):

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

Dark theme, black background
Green (#22c55e) as primary accent
State-based background colors for workout screen
Tailwind v4 for styling
Clean, minimal gym aesthetic
Pencil icon (✏️) for edit playlists on dashboard

User Identity:

No email returned in Spotify session — using session.user.name as user_id in Supabase

GitHub repo: https://github.com/babacaca123/LiftSync


Additional context:

Do not ask me technical questions, make the best decisions for a clean gym app
Color scheme: keep dark/moody aesthetic (bg-red-950, bg-blue-950 etc.), accent colors should react to state (buttons, progress bars, text)
Done state should be green
Exercising transition: 300ms (punchy), Resting transition: 700ms (slow calm fade)
Full screen color wash transitions
Start by fixing these in order: 1 superset logic, 2 save playlists to Supabase, 3 saved workout → direct to workout screen


commit everything to GitHub with a descriptive message


when to commit: Unit of Work: When you finish a single function, fix a bug, or complete a specific subtask.Working State: Every time your code is in a stable, buildable state.Before Risky Changes: Just before you attempt a major refactor or "try something out" that might break things.End of Session: At least once per day to ensure your local progress is backed up.

