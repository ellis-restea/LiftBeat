"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { useSession } from "next-auth/react";
import { supabase } from "@/lib/supabase";
import LoadingScreen from "../components/LoadingScreen";
import { feedback } from "@/lib/feedback";

interface Exercise {
  name: string;
  sets: number;
  reps: number;
  rest_seconds: number;
  superset_with: number | null;
}

export default function WorkoutSetup() {
  return <Suspense><WorkoutSetupInner /></Suspense>;
}

function WorkoutSetupInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const editId = searchParams.get("workout_id"); // present when editing an existing workout
  const isEditing = !!editId;
  const isOnboarding = searchParams.get("from") === "onboarding";

  const [workoutName, setWorkoutName] = useState("");
  const [exercises, setExercises] = useState<Exercise[]>([
    { name: "", sets: 3, reps: 12, rest_seconds: 120, superset_with: null },
  ]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(isEditing);
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // Load existing workout data when editing
  useEffect(() => {
    if (!editId) return;
    Promise.all([
      supabase.from("workouts").select("name").eq("id", editId).single(),
      supabase.from("exercises").select("*").eq("workout_id", editId).order("order_index"),
    ]).then(([workoutRes, exRes]) => {
      if (workoutRes.data) setWorkoutName(workoutRes.data.name);
      if (exRes.data && exRes.data.length > 0) {
        setExercises(
          exRes.data.map((ex: any) => ({
            name: ex.name,
            sets: ex.sets,
            reps: ex.reps,
            rest_seconds: ex.rest_seconds,
            superset_with: ex.superset_with,
          }))
        );
      }
      setLoadingEdit(false);
    });
  }, [editId]);

  const handleBack = () => {
    if (isDirty) {
      setShowUnsavedDialog(true);
    } else {
      router.back();
    }
  };

  const addExercise = () => {
    feedback("light");
    setIsDirty(true);
    setExercises([...exercises, { name: "", sets: 3, reps: 12, rest_seconds: 120, superset_with: null }]);
  };

  const updateExercise = (index: number, field: keyof Exercise, value: any) => {
    feedback("light");
    setIsDirty(true);
    const updated = [...exercises];
    updated[index] = { ...updated[index], [field]: value };

    if (field === "rest_seconds") {
      const aIdx = updated[index].superset_with;
      if (aIdx != null) updated[aIdx] = { ...updated[aIdx], rest_seconds: value as number };
      const bIdx = updated.findIndex((ex, i) => i !== index && ex.superset_with === index);
      if (bIdx !== -1) updated[bIdx] = { ...updated[bIdx], rest_seconds: value as number };
    }

    setExercises(updated);
  };

  const toggleSuperset = (index: number) => {
    feedback("light");
    setIsDirty(true);
    const updated = [...exercises];
    const current = updated[index];
    const partnerIdx = index - 1;
    const enabling = current.superset_with !== partnerIdx;
    updated[index] = {
      ...current,
      superset_with: enabling ? partnerIdx : null,
      rest_seconds: enabling ? updated[partnerIdx].rest_seconds : current.rest_seconds,
    };
    setExercises(updated);
  };

  const removeExercise = (index: number) => {
    setIsDirty(true);
    setExercises(exercises.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!workoutName.trim() || !session?.user?.name) return;
    feedback("medium");
    setSaving(true);
    setSaveError(null);

    const exRows = exercises.map((ex, i) => ({
      name: ex.name || `Exercise ${i + 1}`,
      sets: ex.sets,
      reps: ex.reps,
      rest_seconds: ex.rest_seconds,
      order_index: i,
      superset_with: ex.superset_with,
    }));

    if (isEditing && editId) {
      // Update name
      const { error: nameErr } = await supabase
        .from("workouts")
        .update({ name: workoutName.trim() })
        .eq("id", editId);
      if (nameErr) {
        setSaveError(`Failed to update workout: ${nameErr.message}`);
        setSaving(false);
        return;
      }

      // Replace exercises: delete old, insert new
      await supabase.from("exercises").delete().eq("workout_id", editId);
      const { error: exErr } = await supabase
        .from("exercises")
        .insert(exRows.map((r) => ({ ...r, workout_id: editId })));
      if (exErr) {
        setSaveError(`Failed to save exercises: ${exErr.message}`);
        setSaving(false);
        return;
      }
    } else {
      // Create new workout
      const { data: workout, error } = await supabase
        .from("workouts")
        .insert({ name: workoutName.trim(), user_id: session.user.name })
        .select()
        .single();
      if (error || !workout) { setSaving(false); return; }

      const { error: exErr } = await supabase
        .from("exercises")
        .insert(exRows.map((r) => ({ ...r, workout_id: workout.id })));
      if (exErr) {
        console.error("[LiftBeat] Exercise insert failed:", exErr);
        await supabase.from("workouts").delete().eq("id", workout.id);
        setSaveError(
          `Failed to save exercises: ${exErr.message}. If you see "column superset_with does not exist", run this SQL in Supabase: ALTER TABLE exercises ADD COLUMN superset_with integer;`
        );
        setSaving(false);
        return;
      }
    }

    router.push("/dashboard");
  };

  if (loadingEdit) return <LoadingScreen />;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#f1f5f9] p-8">
      {showUnsavedDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', background: 'rgba(0,0,0,0.6)' }}
        >
          <div
            className="card-metallic rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4"
            style={{ animation: 'liftfade 200ms ease forwards' }}
          >
            <div>
              <h2 className="text-xl font-bold text-white">Unsaved changes</h2>
              <p className="text-[#64748b] text-sm mt-1">Your changes haven't been saved yet.</p>
            </div>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setShowUnsavedDialog(false)}
                className="w-full bg-blue-500 hover:bg-blue-400 text-white font-bold py-4 rounded-xl text-base active:scale-95 transition-transform"
              >
                Keep Editing
              </button>
              <button
                onClick={() => router.back()}
                className="w-full text-red-400 hover:text-red-300 font-semibold py-3 rounded-xl text-base active:scale-95 transition-colors border border-red-500/30 hover:border-red-500/50"
              >
                Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-md mx-auto">
        <div className="flex items-center mb-8">
          {!isOnboarding && (
            <button
              onClick={handleBack}
              className="mr-3 -ml-1 text-[#64748b] hover:text-white active:scale-95 transition-all touch-manipulation"
              aria-label="Back"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
              </svg>
            </button>
          )}
          <h1 className="text-3xl font-bold tracking-wide">{isEditing ? "Edit workout" : "Build your workout"}</h1>
        </div>

        <div className="grid gap-6">
          <div className="card-metallic rounded-xl p-6">
            <label className="text-[#64748b] text-sm mb-2 block">Workout Name</label>
            <input
              type="text"
              value={workoutName}
              onChange={(e) => { setWorkoutName(e.target.value); setIsDirty(true); }}
              placeholder="e.g. Upper Body A"
              className="w-full bg-[#0a0a0f] text-[#f1f5f9] rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 border border-white/10"
            />
          </div>

          {exercises.map((ex, index) => (
            <div key={index} className="card-metallic rounded-xl p-6 grid gap-4">
              <div className="flex justify-between items-center">
                <h2 className="font-semibold tracking-wide">Exercise {index + 1}</h2>
                {exercises.length > 1 && (
                  <button onClick={() => removeExercise(index)} className="text-red-400 hover:text-red-300 text-sm active:scale-95 transition-transform">
                    Remove
                  </button>
                )}
              </div>

              <input
                type="text"
                value={ex.name}
                onChange={(e) => updateExercise(index, "name", e.target.value)}
                placeholder="e.g. Bench Press"
                className="w-full bg-[#0a0a0f] text-[#f1f5f9] rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 border border-white/10"
              />

              <div className="flex justify-between items-center">
                <label className="text-[#94a3b8]">Sets</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => updateExercise(index, "sets", Math.max(1, ex.sets - 1))} className="w-8 h-8 rounded-full bg-[#1a1d2e] hover:bg-[#252840] border border-white/10 flex items-center justify-center active:scale-95 transition-transform">-</button>
                  <span className="w-6 text-center">{ex.sets}</span>
                  <button onClick={() => updateExercise(index, "sets", ex.sets + 1)} className="w-8 h-8 rounded-full bg-[#1a1d2e] hover:bg-[#252840] border border-white/10 flex items-center justify-center active:scale-95 transition-transform">+</button>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <label className="text-[#94a3b8]">Reps</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => updateExercise(index, "reps", Math.max(1, ex.reps - 1))} className="w-8 h-8 rounded-full bg-[#1a1d2e] hover:bg-[#252840] border border-white/10 flex items-center justify-center active:scale-95 transition-transform">-</button>
                  <span className="w-6 text-center">{ex.reps}</span>
                  <button onClick={() => updateExercise(index, "reps", ex.reps + 1)} className="w-8 h-8 rounded-full bg-[#1a1d2e] hover:bg-[#252840] border border-white/10 flex items-center justify-center active:scale-95 transition-transform">+</button>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <label className="text-[#94a3b8]">Rest (seconds)</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => updateExercise(index, "rest_seconds", Math.max(15, ex.rest_seconds - 15))} className="w-8 h-8 rounded-full bg-[#1a1d2e] hover:bg-[#252840] border border-white/10 flex items-center justify-center active:scale-95 transition-transform">-</button>
                  <span className="w-12 text-center">{ex.rest_seconds}s</span>
                  <button onClick={() => updateExercise(index, "rest_seconds", ex.rest_seconds + 15)} className="w-8 h-8 rounded-full bg-[#1a1d2e] hover:bg-[#252840] border border-white/10 flex items-center justify-center active:scale-95 transition-transform">+</button>
                </div>
              </div>

              {index > 0 && (
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-[#94a3b8]">Superset</p>
                    <p className="text-[#64748b] text-sm">
                      {ex.superset_with != null
                        ? `Paired with Exercise ${index} · rest synced`
                        : `Pair with Exercise ${index}`}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleSuperset(index)}
                    className={`w-12 h-6 rounded-full transition ${ex.superset_with != null ? "bg-blue-500" : "bg-[#1a1d2e] border border-white/10"}`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full transition-transform mx-0.5 ${ex.superset_with != null ? "translate-x-6" : ""}`} />
                  </button>
                </div>
              )}
            </div>
          ))}

          <button
            onClick={addExercise}
            className="w-full border border-blue-500/40 hover:border-blue-500 text-[#64748b] hover:text-blue-400 py-3 rounded-xl transition active:scale-95"
          >
            + Add Exercise
          </button>

          {saveError && (
            <div className="bg-red-950 border border-red-500/40 rounded-xl p-4 text-red-300 text-sm">
              {saveError}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={!workoutName.trim() || saving}
            className="w-full bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-bold py-4 rounded-xl text-lg transition active:scale-95 btn-animated"
          >
            {saving ? "Saving..." : isEditing ? "Update Workout →" : "Save Workout →"}
          </button>
        </div>
      </div>
    </div>
  );
}
