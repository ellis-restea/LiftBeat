LiftBeat

LiftBeat is a workout app that automatically controls your Spotify music based on what you're doing in the gym.

When you're in a set — high energy music plays. When you're resting — it switches to something calmer. When your rest timer ends — the hype comes back automatically. No more fumbling with your phone between sets.

Live at: lift-sync-ashen.vercel.app

How it works

You log in with Spotify and select your workout playlist
You build your workout — exercises, sets, reps, rest time, supersets
LiftBeat analyzes the BPM of songs currently in your Spotify queue using the Songstats API
Songs above the BPM threshold are classified as high energy, below as low energy
When you press Start Workout, the app enters warmup mode and plays high energy music
You press Done with Set → app switches to low energy music and starts your rest countdown
Rest timer hits zero → high energy music kicks back in automatically
Repeat until workout complete

For supersets, the app skips the rest period between paired exercises and only rests after both are done.

Architecture

Frontend: Next.js 16 (App Router), React, TypeScript, Tailwind v4
Backend/Database: Supabase (PostgreSQL) — stores workouts, exercises, user playlists, and a BPM cache so the same song is never looked up twice
Auth: NextAuth v4 with Spotify OAuth and automatic token refresh
BPM Detection: Songstats API — looks up tempo by Spotify track ID, results cached in Supabase
Music Control: Spotify Web API — reads the current queue, checks BPM of upcoming tracks, skips songs that don't match the current workout state
Deployment: Vercel with automatic deploys from GitHub
Mobile: Progressive Web App (PWA) — installable on iPhone via Safari, runs fullscreen, Wake Lock keeps screen on during workouts

Workout States

idle → warmup → exercising → resting → done

Each state transition triggers a BPM check on the current track and skips forward until a matching energy song is found.
