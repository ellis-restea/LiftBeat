"use client";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LoadingScreen from "./components/LoadingScreen";

export default function Home() {
  const { status } = useSession();
  const router = useRouter();
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMinTimeElapsed(true), 1000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!minTimeElapsed || status === "loading") return;
    router.replace(status === "authenticated" ? "/dashboard" : "/landing");
  }, [minTimeElapsed, status]);

  return <LoadingScreen />;
}
