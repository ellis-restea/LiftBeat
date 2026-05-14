import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const playlistId = req.nextUrl.searchParams.get("id");
  if (!playlistId) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  const tracks: { id: string; name: string; artists: string[] }[] = [];
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!res.ok) {
      return Response.json(
        { error: "Spotify error", status: res.status },
        { status: res.status }
      );
    }
    const data = await res.json();
    for (const item of data.items ?? []) {
      if (item?.track?.id) {
        tracks.push({
          id: item.track.id,
          name: item.track.name,
          artists: item.track.artists?.map((a: { name: string }) => a.name) ?? [],
        });
      }
    }
    url = data.next ?? null;
  }

  return Response.json({ tracks });
}
