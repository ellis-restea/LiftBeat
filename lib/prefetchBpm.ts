/**
 * After a user selects playlists, call this to kick off Songstats BPM
 * lookup and Supabase caching in the background.  Fire-and-forget — do
 * NOT await at the call site so navigation is never blocked.
 */
export async function prefetchPlaylistsBpm(
  playlistIds: string[],
  accessToken: string,
): Promise<void> {
  for (const pid of playlistIds) {
    try {
      const tracks: { id: string; name: string; artists: string[] }[] = [];
      let url: string | null =
        `https://api.spotify.com/v1/playlists/${pid}/tracks?limit=100`;

      while (url) {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) break;
        const data = await res.json();
        for (const item of data.items ?? []) {
          if (item?.track?.id) {
            tracks.push({
              id: item.track.id,
              name: item.track.name,
              artists: (item.track.artists ?? []).map((a: any) => a.name),
            });
          }
        }
        url = data.next ?? null;
      }

      if (tracks.length === 0) continue;

      console.log(`[BPM Prefetch] ${pid} — ${tracks.length} tracks → Songstats`);
      const r = await fetch("/api/playlist-bpm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracks }),
      });
      if (r.ok) {
        const result = await r.json();
        console.log(
          `[BPM Prefetch] ${pid} done — HIGH: ${result.high?.length ?? 0}, LOW: ${result.low?.length ?? 0}, cached: ${result.fromCache}, fresh: ${result.fromApi}`,
        );
      }
    } catch {
      // Non-fatal — prefetch is best-effort
    }
  }
}
