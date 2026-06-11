"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import BottomNav from "./BottomNav";
import HomeTab from "./tabs/HomeTab";
import MusicTab from "./tabs/MusicTab";
import StatsTab from "./tabs/StatsTab";
import SettingsTab from "./tabs/SettingsTab";

interface Props { initialTab?: number; }

export default function AppShell({ initialTab = 0 }: Props) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab]     = useState(initialTab);
  const [hasPlaylists, setHasPlaylists] = useState(false);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status]);

  useEffect(() => {
    if (!session?.user?.name) return;
    Promise.all([
      supabase.from("user_playlists").select("playlist_ids").eq("user_id", session.user.name).single(),
      supabase.from("user_settings").select("onboarding_completed").eq("user_id", session.user.name).maybeSingle(),
    ]).then(([playlistRes, settingsRes]) => {
      setHasPlaylists(Array.isArray(playlistRes.data?.playlist_ids) && playlistRes.data.playlist_ids.length > 0);
      if (!settingsRes.data?.onboarding_completed) {
        router.replace("/onboarding-gate");
      }
    });
  }, [session]);

  // Play entry animation on the initial tab once mounted
  useEffect(() => {
    const el = panelRefs.current[initialTab];
    if (el) el.classList.add("tab-enter");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Switching tabs: show new panel and re-trigger its CSS animation without unmounting
  const handleTabChange = useCallback((i: number) => {
    setActiveTab(i);
    requestAnimationFrame(() => {
      const el = panelRefs.current[i];
      if (!el) return;
      el.classList.remove("tab-enter");
      void el.offsetHeight; // force reflow so the browser resets the animation
      el.classList.add("tab-enter");
    });
  }, []);

  // Only block on session auth — a tiny spinner, not the full LoadingScreen
  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: "2px solid rgba(59,130,246,0.2)",
            borderTopColor: "#3b82f6",
            animation: "spin 0.8s linear infinite",
          }}
        />
      </div>
    );
  }

  if (status === "unauthenticated") return null;

  const tabs = [
    <HomeTab hasPlaylists={hasPlaylists} />,
    <MusicTab onDone={() => handleTabChange(0)} />,
    <StatsTab />,
    <SettingsTab />,
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#f1f5f9]">
      {tabs.map((tab, i) => (
        <div
          key={i}
          ref={(el) => { panelRefs.current[i] = el; }}
          style={{ display: i === activeTab ? "block" : "none", paddingBottom: 104 }}
        >
          {tab}
        </div>
      ))}
      {hasPlaylists && (
        <BottomNav activeIndex={activeTab} onTabChange={handleTabChange} />
      )}
    </div>
  );
}
