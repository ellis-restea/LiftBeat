"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { supabase } from "@/lib/supabase";

interface Exercise {
  name: string;
  sets: number;
  reps: number;
  rest_seconds: number;
  superset_with: number | null;
}

export default function WorkoutSetup() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const editId = searchParams.get("workout_id"); // present when editing an existing workout
  const isEditing = !!editId;

  const [workoutName, setWorkoutName] = useState("");
  const [exercises, setExercises] = useState<Exercise[]>([
    { name: "", sets: 3, reps: 12, rest_seconds: 120, superset_with: null },
  ]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(isEditing);

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

  const addExercise = () => {
    setExercises([...exercises, { name: "", sets: 3, reps: 12, rest_seconds: 120, superset_with: null }]);
  };

  const updateExercise = (index: number, field: keyof Exercise, value: any) => {
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
    setExercises(exercises.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!workoutName.trim() || !session?.user?.name) return;
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
        console.error("[LiftSync] Exercise insert failed:", exErr);
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

  if (loadingEdit)
    return (
      <div className="flex items-center justify-center min-h-screen bg-black text-white">
        Loading workout...
      </div>
    );

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-md mx-auto">
        <h1 className="text-3xl font-bold mb-2">LiftSync</h1>
        <p className="text-gray-400 mb-8">{isEditing ? "Edit workout" : "Build your workout"}</p>

        <div className="grid gap-6">
          <div className="bg-gray-900 rounded-xl p-6">
            <label className="text-gray-400 text-sm mb-2 block">Workout Name</label>
            <input
              type="text"
              value={workoutName}
              onChange={(e) => setWorkoutName(e.target.value)}
              placeholder="e.g. Upper Body A"
              className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {exercises.map((ex, index) => (
            <div key={index} className="bg-gray-900 rounded-xl p-6 grid gap-4">
              <div className="flex justify-between items-center">
                <h2 className="font-semibold">Exercise {index + 1}</h2>
                {exercises.length > 1 && (
                  <button onClick={() => removeExercise(index)} className="text-red-400 hover:text-red-300 text-sm">
                    Remove
                  </button>
                )}
              </div>

              <input
                type="text"
                value={ex.name}
                onChange={(e) => updateExercise(index, "name", e.target.value)}
                placeholder="e.g. Bench Press"
                className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-green-500"
              />

              <div className="flex justify-between items-center">
                <label className="text-gray-300">Sets</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => updateExercise(index, "sets", Math.max(1, ex.sets - 1))} className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center">-</button>
                  <span className="w-6 text-center">{ex.sets}</span>
                  <button onClick={() => updateExercise(index, "sets", ex.sets + 1)} className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center">+</button>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <label className="text-gray-300">Reps</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => updateExercise(index, "reps", Math.max(1, ex.reps - 1))} className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center">-</button>
                  <span className="w-6 text-center">{ex.reps}</span>
                  <button onClick={() => updateExercise(index, "reps", ex.reps + 1)} className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center">+</button>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <label className="text-gray-300">Rest (seconds)</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => updateExercise(index, "rest_seconds", Math.max(15, ex.rest_seconds - 15))} className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center">-</button>
                  <span className="w-12 text-center">{ex.rest_seconds}s</span>
                  <button onClick={() => updateExercise(index, "rest_seconds", ex.rest_seconds + 15)} className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center">+</button>
                </div>
              </div>

              {index > 0 && (
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-gray-300">Superset</p>
                    <p className="text-gray-500 text-sm">
                      {ex.superset_with != null
                        ? `Paired with Exercise ${index} · rest synced`
                        : `Pair with Exercise ${index}`}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleSuperset(index)}
                    className={`w-12 h-6 rounded-full transition ${ex.superset_with != null ? "bg-green-500" : "bg-gray-700"}`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full transition-transform mx-0.5 ${ex.superset_with != null ? "translate-x-6" : ""}`} />
                  </button>
                </div>
              )}
            </div>
          ))}

          <button
            onClick={addExercise}
            className="w-full border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white py-3 rounded-xl transition"
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
            className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-4 rounded-xl text-lg transition"
          >
            {saving ? "Saving..." : isEditing ? "Update Workout →" : "Save Workout →"}
          </button>
        </div>
      </div>
    </div>
  );
}
