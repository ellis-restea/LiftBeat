"use client";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { prefetchPlaylistsBpm } from "@/lib/prefetchBpm";
import { feedback } from "@/lib/feedback";

interface Props { onDone: () => void; }

export default function MusicTab({ onDone }: Props) {
  return (
    <div className="relative flex flex-col items-center justify-center min-h-[80vh] px-8 text-center overflow-hidden">
      {/* Glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            "radial-gradient(ellipse 60% 40% at 50% 30%, #3b82f622 0%, transparent 70%)",
            "radial-gradient(ellipse 40% 25% at 50% 30%, #3b82f610 0%, transparent 60%)",
          ].join(", "),
        }}
      />

      <div className="relative flex flex-col items-center gap-5 max-w-xs">
        {/* Icon */}
        <div className="card-metallic w-20 h-20 rounded-2xl flex items-center justify-center text-4xl shadow-lg">
          🎵
        </div>

        {/* Badge */}
        <span className="bg-blue-500/15 text-blue-400 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-widest border border-blue-500/25">
          Coming Soon
        </span>

        {/* Heading */}
        <h2 className="text-2xl font-black tracking-wide text-[#f1f5f9]">
          Playlist Intelligence
        </h2>

        {/* Subheading */}
        <p className="text-[#64748b] text-sm leading-relaxed">
          LiftBeat will learn your music over time — automatically mixing your playlists based on your workout state, tempo, and energy level.
        </p>
      </div>
    </div>
  );
}

// ─── Original implementation preserved below ────────────────────────────────
// Kept intact for when Spotify dev mode restrictions are lifted.

function MusicTabFull({ onDone }: Props) {
  const { data: session, status } = useSession();
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [selected, setSelected]   = useState<string[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading" || !session?.accessToken || !session?.user?.name) return;

    Promise.all([
      fetch("https://api.spotify.com/v1/me/playlists?limit=50", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      }).then(async (r) => {
        if (!r.ok) throw new Error(`Spotify ${r.status}`);
        return r.json();
      }),
      supabase
        .from("user_playlists")
        .select("playlist_ids")
        .eq("user_id", session.user.name)
        .single(),
    ])
      .then(([spotifyData, dbData]) => {
        setPlaylists(spotifyData.items || []);
        if (Array.isArray(dbData.data?.playlist_ids)) {
          setSelected(dbData.data.playlist_ids);
        }
        setLoading(false);
      })
      .catch(() => {
        setFetchError("Couldn't load playlists. Check your connection and try again.");
        setLoading(false);
      });
  }, [session, status]);

  const toggle = (id: string) => {
    feedback("medium");
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleSave = async () => {
    if (!session?.user?.name || selected.length === 0) return;
    feedback("medium");
    setSaving(true);
    await supabase
      .from("user_playlists")
      .upsert({ user_id: session.user.name, playlist_ids: selected }, { onConflict: "user_id" });

    prefetchPlaylistsBpm(selected);

    setSaving(false);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onDone();
    }, 900);
  };

  if (loading) return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        <div className="skeleton h-8 w-28 mb-2" />
        <div className="skeleton h-4 w-72 mb-6" />
        <div className="card-metallic rounded-xl p-4 mb-6 h-14" />
        <div className="grid gap-2">
          {[65, 80, 55, 75, 60, 70].map((w, i) => (
            <div key={i} className="card-metallic rounded-xl p-3 flex items-center gap-4">
              <div className="skeleton w-12 h-12 rounded-lg shrink-0" />
              <div className="flex-1 grid gap-2">
                <div className="skeleton h-4 rounded" style={{ width: `${w}%` }} />
                <div className="skeleton h-3 rounded w-14" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (fetchError)
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center gap-4">
        <p className="text-red-400">{fetchError}</p>
      </div>
    );

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold tracking-wide mb-1">Music</h1>
        <p className="text-[#64748b] mb-6">
          LiftBeat switches between high and low BPM tracks during your workout.
        </p>

        <div className="card-metallic rounded-xl p-4 mb-6 text-sm text-[#94a3b8] flex gap-3">
          <span className="text-blue-500 text-lg">💡</span>
          <p>
            Select playlists with a mix of tempos for best results. LiftBeat handles the rest.
          </p>
        </div>

        <div className="grid gap-2 mb-8">
          {playlists.map((playlist: any) => {
            const isSelected = selected.includes(playlist.id);
            return (
              <div
                key={playlist.id}
                onClick={() => toggle(playlist.id)}
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
                    alt={playlist.name}
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
            onClick={handleSave}
            disabled={saving || saved}
            className="w-full bg-blue-500 hover:bg-blue-400 disabled:opacity-70 text-white font-bold py-4 rounded-xl text-lg transition active:scale-95 btn-animated"
          >
            {saved
              ? "Saved ✓"
              : saving
              ? "Saving…"
              : `Save ${selected.length} playlist${selected.length > 1 ? "s" : ""}`}
          </button>
        )}
      </div>
    </div>
  );
}
