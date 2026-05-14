export async function prefetchPlaylistsBpm(playlistIds: string[]): Promise<void> {
  for (const pid of playlistIds) {
    try {
      const res = await fetch(`/api/playlist-tracks?id=${pid}`);
      if (!res.ok) continue;
      const { tracks } = await res.json();
      if (!tracks?.length) continue;

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
