// Disabled — Spotify blocks the /playlists/{id}/tracks endpoint in dev mode.
// Track sourcing now uses /api/queue-tracks (live Spotify queue) instead.
export async function GET() {
  return Response.json({ error: "Disabled — use /api/queue-tracks" }, { status: 410 });
}
