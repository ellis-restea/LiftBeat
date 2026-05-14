import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return Response.json({ error: "No session" }, { status: 401 });
  }

  const grantedScopes = session.scope?.split(" ") ?? [];
  const requiredScopes = [
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state",
    "playlist-read-private",
    "playlist-read-collaborative",
    "streaming",
  ];
  const missingScopes = requiredScopes.filter((s) => !grantedScopes.includes(s));

  console.log("[debug] token preview:", session.accessToken?.slice(-10));

  // Fetch the current Spotify user's profile
  const meRes = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  const meData = await meRes.json().catch(() => null);
  const spotifyUserId = meData?.id;

  const targetPlaylistId = "4DI0jvlnqLWY9niByaFxiv";

  // Test metadata endpoint
  const metaRes = await fetch(
    `https://api.spotify.com/v1/playlists/${targetPlaylistId}?fields=id,name,owner`,
    { headers: { Authorization: `Bearer ${session.accessToken}` }, cache: "no-store" }
  );
  const metaBody = await metaRes.json().catch(() => null);

  // Test tracks endpoint (the one that's failing)
  const tracksRes = await fetch(
    `https://api.spotify.com/v1/playlists/${targetPlaylistId}/tracks?limit=1&additional_types=track`,
    { headers: { Authorization: `Bearer ${session.accessToken}` }, cache: "no-store" }
  );
  const tracksBody = await tracksRes.json().catch(() => null);

  return Response.json({
    grantedScopes,
    missingScopes,
    allScopesPresent: missingScopes.length === 0,
    spotifyUserId,
    spotifyDisplayName: meData?.display_name,
    targetPlaylist: {
      id: targetPlaylistId,
      metadataStatus: metaRes.status,
      name: metaBody?.name,
      ownerId: metaBody?.owner?.id,
      youOwnIt: metaBody?.owner?.id === spotifyUserId,
      tracksStatus: tracksRes.status,
      tracksFirstItem: tracksBody?.items?.[0]?.track?.name ?? tracksBody,
    },
  });
}
