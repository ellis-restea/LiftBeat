import { supabase } from "./supabase";

export type DjMode = "responsive" | "chill";

export async function loadDjMode(userId: string): Promise<DjMode> {
  const { data } = await supabase
    .from("user_settings")
    .select("dj_mode")
    .eq("user_id", userId)
    .single();
  return data?.dj_mode === "chill" ? "chill" : "responsive";
}

export async function saveDjMode(userId: string, mode: DjMode): Promise<void> {
  await supabase.from("user_settings").upsert(
    { user_id: userId, dj_mode: mode, updated_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
}
