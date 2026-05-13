"use client";
import { useSession } from "next-auth/react";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { prefetchPlaylistsBpm } from "@/lib/prefetchBpm";
import LoadingScreen from "../components/LoadingScreen";

export default function PlaylistSelect() {
  return <Suspense><PlaylistSelectInner /></Suspense>;
}

function PlaylistSelectInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");

  const [playlists, setPlaylists] = useState([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status]);

  useEffect(() => {
    if (status === "loading") return;

    if (!session?.accessToken) {
      console.error("No Spotify access token on session:", session);
      setFetchError("Missing Spotify access token — try signing out and back in.");
      setLoading(false);
      return;
    }

    fetch("https://api.spotify.com/v1/me/playlists?limit=50", {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Spotify ${res.status}: ${body}`);
        }
        return res.json();
      })
      .then((data) => {
        console.log("Playlists loaded:", data.items?.length ?? 0);
        setPlaylists(data.items || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load playlists:", err);
        setFetchError("Couldn't load playlists. Check the console and try again.");
        setLoading(false);
      });
  }, [session, status]);

  const togglePlaylist = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleContinue = async () => {
    if (!session?.user?.name || selected.length === 0) return;
    setSaving(true);

    await supabase
      .from("user_playlists")
      .upsert({ user_id: session.user.name, playlist_ids: selected }, { onConflict: "user_id" });

    // Kick off BPM prefetch in background — don't await so navigation isn't blocked
    prefetchPlaylistsBpm(selected, session.accessToken!);

    router.push(mode === "edit" ? "/dashboard" : "/workout-setup");
  };

  if (loading) return <LoadingScreen />;

  if (fetchError)
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0f] text-[#f1f5f9] gap-4 p-8 text-center">
        <p className="text-red-400 text-lg font-light">{fetchError}</p>
        <button
          onClick={() => router.push("/dashboard")}
          className="text-[#64748b] hover:text-white underline text-sm"
        >
          Back to dashboard
        </button>
      </div>
    );

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#f1f5f9] p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold tracking-wide mb-1">
          {mode === "edit" ? "Update playlists" : "Pick your playlists"}
        </h1>
        <p className="text-[#64748b] mb-6">
          LiftSync will automatically switch between high and low BPM tracks during your workout.
        </p>

        <div className="card-metallic rounded-xl p-4 mb-6 text-sm text-[#94a3b8] flex gap-3">
          <span className="text-blue-500 text-lg">💡</span>
          <p>
            For the best experience, use a playlist with a variety of songs or select multiple
            playlists. LiftSync will handle the rest.
          </p>
        </div>

        <div className="grid gap-2 mb-8">
          {playlists.map((playlist: any) => {
            const isSelected = selected.includes(playlist.id);
            return (
              <div
                key={playlist.id}
                onClick={() => togglePlaylist(playlist.id)}
                className={`flex items-center gap-4 rounded-xl p-3 cursor-pointer transition border ${
                  isSelected
                    ? "bg-blue-500/10 border-blue-500"
                    : "card-metallic hover:border-blue-500/30"
                }`}
              >
                {playlist.images?.[0] ? (
                  <img
                    src={playlist.images[0].url}
                    className="w-12 h-12 rounded-lg object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-[#1a1d2e] flex items-center justify-center text-[#64748b]">
                    ♪
                  </div>
                )}
                <div className="flex-1">
                  <p className="font-semibold">{playlist.name}</p>
                  <p className="text-[#64748b] text-sm">{playlist.tracks?.total} songs</p>
                </div>
                {isSelected && <span className="text-blue-400 text-xl">✓</span>}
              </div>
            );
          })}
        </div>

        {selected.length > 0 && (
          <button
            onClick={handleContinue}
            disabled={saving}
            className="w-full bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-bold py-4 rounded-xl text-lg transition active:scale-95 btn-animated"
          >
            {saving
              ? "Saving..."
              : mode === "edit"
              ? `Save ${selected.length} playlist${selected.length > 1 ? "s" : ""}`
              : `Continue with ${selected.length} playlist${selected.length > 1 ? "s" : ""} →`}
          </button>
        )}
      </div>
    </div>
  );
}
