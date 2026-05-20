@AGENTS.md


LiftBeat — Project Summary & Handoff
What is LiftBeat:
A web app that controls the user's Spotify playback during gym workouts. High BPM songs play during sets, low BPM songs play during rest periods. Automatically switches based on a workout timer. Built with Next.js, Supabase, and Spotify API.
Tech Stack:

Next.js 16 (App Router, TypeScript, Tailwind v4)
Supabase (database)
NextAuth v4 (Spotify OAuth)
Spotify Web API (playback control, BPM data)
Running locally on http://127.0.0.1:3000

Current File Structure:
app/
  page.tsx              — Splash screen: always shown on app open, 1s minimum, routes to /dashboard or /landing
  landing/page.tsx      — Landing page (Get Started / Log In) — unauthenticated users land here after splash
  layout.tsx            — Root layout with SessionProvider
  providers.tsx         — Client-side SessionProvider wrapper
  globals.css           — Tailwind imports + .skeleton shimmer + tabEnter + swish-border + eq-beat animations
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
    LoadingScreen.tsx   — 4 animated equalizer bars (kick/snare/hihat/bass) + app name, no messages
    MetallicCanvas.tsx  — Full-screen canvas background (dark base + drifting glows + grain + vignette)
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
Splash (/) → Landing (/landing) → Onboarding (3 slides) → Spotify login → Playlist select (saved to Supabase) → Workout setup → Workout screen
Returning user:
Splash (/) → Dashboard (saved workouts list + pencil icon to edit playlists) → Tap workout → Workout screen
Logout flow:
signOut({ callbackUrl: "/" }) → Splash → Landing (clean, no flicker)
Important flow notes:

Playlist select is ONE TIME during onboarding only
After onboarding, selected playlists are saved in Supabase under user_playlists table
Dashboard has a small pencil/edit icon that takes user back to playlist-select to update their saved playlists
Workout screen loads playlists from Supabase, not from URL params
No payment screen for now — launch free to build user base, add subscription later once traction is gained

App Logic — Playback System (current: custom uris queue, queue-snapshot pool):

Pool source: /api/queue-tracks (GET /me/player/queue snapshot) — playlist-tracks endpoint is blocked
  in Spotify dev mode (403). /api/playlist-tracks returns 410. Pool is built from whatever tracks
  are in the user's Spotify queue at page load time.

Preload (on page load, before Start Workout):
  fetchQueueAndEnrich() — fetches /api/queue-tracks → enriches all tracks with BPM via /api/playlist-bpm.
  Builds trackPool (flat TrackBpm[] with bpm). Runs up to 2 extra refreshes if HIGH or LOW bucket = 0.
  recomputeQueues() — rebuilds precomputedHighRef and precomputedLowRef (shuffled URI arrays).
  After preload: runs idle-state BPM correction (see below).

Idle-state auto-correction:
  The 5s polling loop checks if Spotify is playing a LOW BPM track before the workout starts.
  If so, silently mutes + switches to the first HIGH BPM track from the pool (withMuteTransition).
  correctionAppliedRef prevents repeated correction. handleStart checks currentTrackRef.current
  synchronously (no await before the check) to avoid race with the correction loop.

playForState(state): 3-layer fallback, called on state transitions and from verifyAndCorrectBpm.
  1. precomputed queue (precomputedHighRef / precomputedLowRef) — instant, no API call.
  2. Up to 3× retry: refreshes Spotify queue snapshot, merges new tracks into pool, recomputes.
  3. Mute-scan fallback: mutes Spotify, calls /me/player/next up to 10×, BPM-checks each
     incoming track, unmutes (fade-up) on first match. Never leaves audio at 0 on failure.
  All transitions use withMuteTransition (mute → play → 500ms settle → 5-step fade-up over 400ms).
  Never uses context_uri — always uris array.

recomputeQueues(): bucket-specific exhaustion. When HIGH bucket is all played, clears only HIGH IDs
  from playedIdsRef and resets that bucket. LOW bucket is independent. Called after every pool change
  and after every playForState call.

Queue refill: fetchCurrentTrack detects when <5 tracks remain in currentQueueRef relative to
  currently playing track — PUT /play with uris + offset + position_ms to extend queue seamlessly.

verifyAndCorrectBpm(vol): called after skip/prev settle (500ms). Fetches currently-playing,
  looks up BPM from pool. If wrong bucket for current state, calls playForState(ws) (which mutes +
  corrects + fades up). Returns true if correction made (caller skips its own fade-up).
fadeUp(vol): extracted helper — 5-step volume restore over 400ms (80ms between steps).

trackHistoryRef: app-side track history stack (up to 20 URIs). Populated when poll detects track
  change (pushes outgoing track URI). prevTrack() pops from stack and PUT /play with that URI.
  Spotify's native /me/player/previous 403s when app uses custom uris queue — history replaces it.

Scrub bar: 5s poll updates songPosition/songProgress from Spotify. A separate 1s setInterval
  advances songPosition locally by 1000ms when isPlaying=true. Pauses during drag/transition.
  Poll overwrites the local estimate every 5s so drift is bounded.

playedIdsRef: Set of track IDs played this workout. Tracks added when poll detects track change.
deviceIdRef: lazily resolved — cached on Start Workout, also lazily fetched in playForState/prevTrack.
BPM cutoff: 130. ≥130 = HIGH (exercising/warmup), <130 = LOW (resting). Defined in lib/constants.ts as HIGH_BPM_CUTOFF.
Workout states: idle → warmup → exercising → resting → done
Canvas background (MetallicCanvas): state colors match badgeColors — idle=gray-700, warmup=amber-500, exercising=red-500, resting=blue-500, done=green-500.
Rest timer counts down, auto-switches to exercising + calls playForState("exercising") when done.
noDevice banner only shown in idle state — 204 from currently-playing during active workout is ignored.
Spotify scopes: user-read-private user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative streaming
show_dialog: true on Spotify OAuth to always force consent screen

Diagnostic timing logs: [⏱ ...] console.logs still present in workout/page.tsx — can be removed
  once timing issues are confirmed resolved.

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

*** RESOLVED BY WORKAROUND: 403 on GET /playlists/{id}/tracks ***
Spotify dev mode blocks the playlist tracks endpoint. Worked around by building the track pool
entirely from the live Spotify queue snapshot (/api/queue-tracks → /me/player/queue).
/api/playlist-tracks is disabled (returns 410). Pool variance depends on what's in the user's
Spotify queue at page load. Mitigated with: preload balance check (2 extra refreshes if HIGH or
LOW = 0), 3-retry logic in playForState, and mute-scan fallback.
Root cause (playlist 403) still unresolved — will fix properly when app leaves dev mode.

Known remaining limitations:
- Pool size depends on Spotify queue depth at preload time. If user has a short queue, pool is small.
- BPM coverage gap for regional/niche music (Songstats returns null tempo) — those tracks go to
  UNKNOWN bucket and are excluded. Tracks with unknown BPM skip BPM verification in verifyAndCorrectBpm.

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

App Name: LiftBeat
Design Language:

Dark base: #111116 → #18181f → #0d0d11 (rendered by MetallicCanvas, not CSS background)
Electric blue (#3b82f6) as primary accent
card-metallic CSS utility: gradient surface + border + shadow
Canvas background (MetallicCanvas): workout screen and landing page use a canvas renderer —
  dark base gradient + two large drifting radial glows (h*0.90 and h*0.75 radii) + static grain texture + edge vignette.
  State color lerps at 0.02/frame so transitions are gradual (~3s to 95%). Landing uses fixed blue (59,130,246).
Primary buttons: solid blue, white text, active:scale-95
Secondary buttons: transparent with blue outline, active:scale-95
Swish border animation: CSS @property --swish-angle conic-gradient sweeping on all CTA buttons
Bottom nav: floating frosted-glass pill (320px, border-radius 9999, blur(20px) backdrop)
All tabs permanently mounted in AppShell (display:block/none) — no remounting, no loading flicker
Shimmer skeleton states in HomeTab and MusicTab while data loads
Tailwind v4 for styling
Clean, minimal gym aesthetic
Workout-setup header: no LiftBeat title — just back arrow + page title ("Edit workout" / "Build your workout") in text-lg font-semibold text-[#64748b]

User Identity:

No email returned in Spotify session — using session.user.name as user_id in Supabase

GitHub repo: https://github.com/babacaca123/LiftBeat


Sound & Haptic Feedback (lib/feedback.ts):

sound(type): Web Audio API sine oscillator with linear ramp fade-out (no click artifact). light=800hz/12ms, medium=600hz/18ms, heavy=400hz/25ms, error=two 300hz pulses.
haptic(type): navigator.vibrate() — light=10ms, medium=15ms, heavy=30ms, error=[50,50,50]. No-ops silently on iOS.
feedback(type): calls both. Checks localStorage ls_sound / ls_haptic (default on).
Guards: (1) input focus guard — skips all feedback when an <input>/<textarea> is focused; (2) 80ms dedup window per type — prevents doubled sounds from rapid taps; (3) 150ms minimum gap between any two sounds — prevents browser audio suppression from silencing bursts.
AudioContext resume is properly awaited before scheduling oscillators.
Wired up: BottomNav tabs (light), workout-setup steppers/add/superset (light), save (medium), MusicTab tap/save (medium), HomeTab delete/confirm/cancel (medium/medium/light), Start Workout/Start Set/Done with Set (heavy).
Settings toggles in SettingsTab persist to ls_sound / ls_haptic.


Navigation & Back Button Decisions:

Workout screen back button: shows a confirmation dialog → on confirm, stops music + navigates away. Dialog itself does not touch music state — only the confirm action does.
Edit workout (workout-setup) back button: simple back navigation. Handle unsaved changes based on current save behavior.
Onboarding flow: no back button at all.

"Open Spotify" Empty State (workout screen, idle):

When no queue is detected at preload, the Start Workout button is replaced by an "Open Spotify" button.
Styling: green Spotify glow, pulse animation, deep-links to the Spotify app.
Muted instruction line underneath explaining the user needs to play a playlist in Spotify first.
Button swaps back to Start Workout automatically once a live queue is detected.

Additional context:

Do not ask me technical questions, make the best decisions for a clean gym app
Color scheme: dark/moody base (bg-[#0a0a0f]), electric blue (#3b82f6) accent, state glow overlays on workout screen
Done state: emerald glow + emerald button
Exercising transition: 300ms (punchy), Resting transition: 700ms (slow calm fade)
Full screen color wash transitions (radial glow overlays, not background-color swap)

commit everything to GitHub with a descriptive message

when to commit: Unit of Work: When you finish a single function, fix a bug, or complete a specific subtask. Working State: Every time your code is in a stable, buildable state. Before Risky Changes: Just before you attempt a major refactor or "try something out" that might break things. End of Session: At least once per day to ensure your local progress is backed up.

Session Summary — May 18 2026:

Architecture change: moved from queue injection to skip-only navigation.
The previous system used POST /v1/me/player/queue to push songs into Spotify's queue. This caused stale songs from previous sessions to linger in the queue and bleed into new workouts. Spotify has no endpoint to clear the queue so injection was abandoned entirely.
New approach: never inject songs, only skip through what Spotify already has naturally queued.

Current queue architecture:
- On every song change, fetch upcoming queue via GET /v1/me/player/queue
- Look up BPM for each song in cache, fetch and cache any unknown songs silently
- Pre-compute and store in refs: skips to next HIGH BPM song, skips to next LOW BPM song
- On state transition: skip counts already known, fire exact N skips in rapid succession, one confirmation poll at end, no unnecessary skips
- On user manual skip: detect via track poll, if new song doesn't match current state fire pre-computed skips immediately
- On idle playback detection: mute first before anything, then use skip counts to land on HIGH BPM song

Console logs always present:
- Current song name and BPM on every track change
- Current workout state on every state change
- Skips to next HIGH and LOW BPM song every time pre-computation runs

Bugs fixed May 18 2026:
- Stale playlist bleeding into new session — caused by queue injection, fixed by removing all POST /v1/me/player/queue calls
- Redundant BPM check on Start Workout press removed — idle state already guarantees HIGH BPM before user hits start
- Wrong BPM bucket being pushed on state transition — state transition was reading outgoing state not incoming
- Session refs not clearing on End Workout — fixed, all refs now explicitly reset
- 401 token expiry on Spotify API calls — NextAuth auto-refresh implemented
- Blip of wrong audio on playlist start — mute now fires as absolute first action before any BPM check

Confirmed Spotify limitations (dev mode):
- GET /v1/playlists/{id}/tracks returns 403 — playlist track fetching permanently blocked in dev mode
- GET /v1/me/player/queue returns max 20 upcoming songs — rolling window, not a fixed pool
- No endpoint exists to clear the Spotify queue
- Spotify extended access requires >1% approval odds and 250k monthly users — not a near term option
- Playlist intelligence feature blocked until out of dev mode — can't link cached tracks to playlists without playlist endpoint

Deferred to post-MVP:
- Responsive vs Chill song switching mode
- Workout resume/save state on back button
- Manual song order change handling
- Playlist intelligence feature

Session Summary — May 19 2026:

Rebrand: LiftSync → LiftBeat across entire codebase.
Every instance of the old name replaced in all forms (LiftSync, liftsync, lift-sync, lift_sync).
Files changed: CLAUDE.md, HomeTab.tsx, MusicTab.tsx, SettingsTab.tsx, onboarding/page.tsx,
playlist-select/page.tsx, workout-setup/page.tsx, workout/page.tsx.
package.json name was already "gymapp" — no change needed. No manifest.json found.
Vercel project name (lift-sync-ashen) requires manual rename in Vercel dashboard — not done via code.
GitHub repo was already renamed by user to LiftBeat before the session.
Pending: run `git remote set-url origin https://github.com/babacaca123/LiftBeat.git` to sync local remote.

Splash screen architecture:
app/page.tsx is now a permanent splash router — always renders LoadingScreen, never the landing content.
Enforces a 1s minimum display via useState + setTimeout so the animation is always visible.
After 1s AND session resolved: authenticated → router.replace("/dashboard"), unauthenticated → router.replace("/landing").
Uses router.replace (not push) so the splash never appears in the browser back stack.
app/landing/page.tsx is a new file containing the former landing page content (hero, stat card, Get Started / Log In).
AppShell unauthenticated redirect goes to "/" → splash → "/landing" — no loop since /landing doesn't redirect back.

LoadingScreen redesign:
Removed rotating star frames (✦✧✸✹✺), rotating interval, and all text messages.
Replaced with 4 animated equalizer bars anchored at the bottom (flex items-end, transformOrigin: "bottom").
Bars: kick (56px), snare (40px), hihat (26px), bass (50px) — each with its own named animation.
Keyframes in globals.css: eq-kick (0.52s linear), eq-snare (0.52s linear offset 0.26s), eq-hihat (0.28s linear),
  eq-bass (1.05s ease-in-out). Non-harmonic durations cause natural phase drift — never perfectly in sync.
Each keyframe has fast attack (scaleY spike at 6–10%) and shaped decay (holds mid then falls) to feel percussive.
Hi-hat has 3 rapid hits per cycle at unequal spacings (10%, 38%, 64%) for organic feel.
Bass sustains at peak for 40% of cycle before falling — sub-note character.
willChange: "transform, opacity" on each bar for GPU acceleration.

Session Summary — May 20 2026:

Canvas-based metallic background (MetallicCanvas component):
New file: app/components/MetallicCanvas.tsx
Replaces all CSS glow/sheen treatments on workout screen and landing page.
Renders 4 layers per rAF: (1) dark linear gradient base (#111116 → #18181f → #0d0d11),
(2) two large drifting radial glows using Math.sin/cos with non-harmonic frequencies,
(3) static grain texture built once per resize on an offscreen canvas (sin(y*3.2) horizontal banding
blended with Math.random(), alpha=12), (4) edge vignette radial gradient (transparent → rgba(0,0,0,0.35)).
Glow radii scale with screen height: h*0.90 and h*0.75 — fills most of screen, both glows bleed together.
Color lerp: 0.02 per frame, ~3s to 95% — smooth state transitions.
Workout screen: stateColors matches badgeColors exactly (gray-700/amber-500/red-500/blue-500/green-500).
Landing page: fixed blue (59, 130, 246), no state changes.
All CSS @property/keyframe declarations for glow-drift, ambient-drift, metallic-sheen removed from globals.css.

Workout-setup header cleanup:
Removed "LiftBeat" h1 title and the subtitle below it.
Page title ("Edit workout" / "Build your workout") moved inline next to back arrow.
Styled as text-lg font-semibold text-[#64748b] — small and muted.

Onboarding gap reduction:
pb-8 → pb-2 on slide containers, pt-4 → pt-0 on bottom section.
Total text-to-button gap: ~78px → ~38px (≈50% reduction).

BPM cutoff correction in CLAUDE.md:
Was incorrectly documented as 120. Actual value is 130 (set in lib/constants.ts in May 19 session).
