"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import LoadingScreen from "./LoadingScreen";
import BottomNav from "./BottomNav";
import HomeTab from "./tabs/HomeTab";
import MusicTab from "./tabs/MusicTab";
import StatsTab from "./tabs/StatsTab";
import SettingsTab from "./tabs/SettingsTab";

interface Props {
  initialTab?: number;
}

export default function AppShell({ initialTab = 0 }: Props) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [hasPlaylists, setHasPlaylists] = useState(false);
  const [navReady, setNavReady] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status]);

  useEffect(() => {
    if (!session?.user?.name) return;
    supabase
      .from("user_playlists")
      .select("playlist_ids")
      .eq("user_id", session.user.name)
      .single()
      .then(({ data }) => {
        const hasPl = Array.isArray(data?.playlist_ids) && data.playlist_ids.length > 0;
        setHasPlaylists(hasPl);
        setNavReady(true);
      });
  }, [session]);

  if (status === "loading" || (status === "authenticated" && !navReady)) {
    return <LoadingScreen />;
  }
  if (status === "unauthenticated") return <LoadingScreen />;

  const renderTab = () => {
    switch (activeTab) {
      case 0:  return <HomeTab hasPlaylists={hasPlaylists} />;
      case 1:  return <MusicTab onDone={() => setActiveTab(0)} />;
      case 2:  return <StatsTab />;
      case 3:  return <SettingsTab />;
      default: return <HomeTab hasPlaylists={hasPlaylists} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#f1f5f9]">
      {/* key forces remount → triggers tabEnter animation on every tab switch */}
      <div key={activeTab} className="tab-enter" style={{ paddingBottom: hasPlaylists ? 104 : 32 }}>
        {renderTab()}
      </div>
      {hasPlaylists && (
        <BottomNav activeIndex={activeTab} onTabChange={setActiveTab} />
      )}
    </div>
  );
}
