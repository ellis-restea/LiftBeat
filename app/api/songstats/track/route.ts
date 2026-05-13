import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const key = process.env.SONGSTATS_API_KEY;
  if (!key) return NextResponse.json({ error: "no key" }, { status: 500 });

  const url = `https://api.songstats.com/enterprise/v1/tracks/info?spotify_track_id=${id}`;
  try {
    const res = await fetch(url, { headers: { apikey: key } });
    const data = await res.json();
    return NextResponse.json({ status: res.status, data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
