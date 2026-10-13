import { NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase-admin"
import { guionRadar } from "@/lib/radar/lectura"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Anatomía del guion de los reels etiquetados. ?pasajes=1 devuelve solo los tramos de cada reel.
export async function GET(request: Request) {
  try {
    const pasajes = new URL(request.url).searchParams.get("pasajes") === "1"
    return NextResponse.json(await guionRadar(createSupabaseAdmin(), pasajes), { headers: { "Cache-Control": "private, max-age=120" } })
  } catch (e) {
    console.error("radar guion", e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
