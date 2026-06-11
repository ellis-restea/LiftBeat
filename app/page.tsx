"use client";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import LoadingScreen from "./components/LoadingScreen";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMinTimeElapsed(true), 1000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.name) return;
    supabase
      .from("user_settings")
      .select("onboarding_completed")
      .eq("user_id", session.user.name)
      .maybeSingle()
      .then(({ data }) => {
        setOnboardingCompleted(data?.onboarding_completed === true);
        setOnboardingChecked(true);
      });
  }, [status, session]);

  useEffect(() => {
    if (!minTimeElapsed) return;
    if (status === "unauthenticated") {
      router.replace("/landing");
      return;
    }
    if (status === "authenticated" && onboardingChecked) {
      router.replace(onboardingCompleted ? "/dashboard" : "/landing");
    }
  }, [minTimeElapsed, status, onboardingChecked, onboardingCompleted]);

  return <LoadingScreen />;
}
