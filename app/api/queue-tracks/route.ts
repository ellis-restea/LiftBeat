import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch("https://api.spotify.com/v1/me/player/queue", {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });

  // 204 = nothing playing, 404 = no active player
  if (res.status === 204 || res.status === 404) {
    return Response.json({ tracks: [], currentlyPlayingId: null });
  }

  if (!res.ok) {
    return Response.json({ error: "Spotify error", status: res.status }, { status: res.status });
  }

  const data = await res.json();

  const tracks: { id: string; name: string; artists: string[] }[] = [];
  const seen = new Set<string>();

  for (const item of [data.currently_playing, ...(data.queue ?? [])]) {
    if (item?.id && item?.type === "track" && !seen.has(item.id)) {
      seen.add(item.id);
      tracks.push({
        id: item.id,
        name: item.name,
        artists: item.artists?.map((a: { name: string }) => a.name) ?? [],
      });
    }
  }

  console.log(`[queue-tracks] ${tracks.length} tracks from Spotify queue`);

  return Response.json({
    tracks,
    currentlyPlayingId: data.currently_playing?.id ?? null,
  });
}
