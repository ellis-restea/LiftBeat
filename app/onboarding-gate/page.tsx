"use client";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import MetallicCanvas from "@/app/components/MetallicCanvas";

export default function OnboardingGate() {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/landing");
      return;
    }
    if (status !== "authenticated" || !session?.user?.name) return;
    supabase
      .from("user_settings")
      .select("onboarding_completed")
      .eq("user_id", session.user.name)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.onboarding_completed === true) {
          router.replace("/dashboard");
        }
      });
  }, [status, session]);

  return (
    <>
      <MetallicCanvas r={59} g={130} b={246} />
      <div
        className="relative min-h-screen text-[#f1f5f9] flex flex-col items-center justify-center px-8 text-center"
        style={{ zIndex: 1 }}
      >
        <div className="max-w-sm w-full flex flex-col items-center gap-6">
          <div className="text-5xl mb-2">👋</div>
          <div>
            <h1 className="text-3xl font-black tracking-wide mb-3 leading-tight">
              Looks like you&apos;re new here
            </h1>
            <p className="text-[#94a3b8] text-base leading-relaxed">
              Please use Get Started to set up your LiftBeat experience
            </p>
          </div>
          <button
            onClick={() => router.push("/onboarding")}
            className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-4 rounded-xl text-lg transition active:scale-95 btn-animated mt-4"
          >
            Get Started
          </button>
        </div>
      </div>
    </>
  );
}
