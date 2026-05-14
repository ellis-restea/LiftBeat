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

  // Test an actual playlist fetch to confirm access
  const testRes = await fetch(
    "https://api.spotify.com/v1/me/playlists?limit=1",
    { headers: { Authorization: `Bearer ${session.accessToken}` } }
  );
  const testBody = await testRes.json().catch(() => null);

  return Response.json({
    grantedScopes,
    missingScopes,
    allScopesPresent: missingScopes.length === 0,
    playlistFetchStatus: testRes.status,
    playlistFetchOk: testRes.ok,
    playlistFetchSample: testBody,
  });
}
