import { NextRequest, NextResponse } from "next/server";

function extractBpm(data: any): number | null {
  // BPM lives in audio_analysis — an array of { key, value } objects.
  // The Songstats response shape can vary; check all known locations.
  const audioAnalysis: any[] =
    data?.track?.audio_analysis ??
    data?.stats?.audio_analysis ??
    data?.audio_analysis ??
    [];
  if (Array.isArray(audioAnalysis)) {
    const item = audioAnalysis.find((a: any) => a.key === "tempo");
    if (item && typeof item.value === "number") return item.value;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const key = process.env.SONGSTATS_API_KEY;
  if (!key) return NextResponse.json({ error: "no key" }, { status: 500 });

  const url = `https://api.songstats.com/enterprise/v1/tracks/info?spotify_track_id=${id}`;
  try {
    const res = await fetch(url, { headers: { apikey: key } });
    const data = await res.json();
    const bpm = extractBpm(data);
    return NextResponse.json({ status: res.status, bpm, raw: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
