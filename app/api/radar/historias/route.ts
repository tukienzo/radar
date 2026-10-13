import { NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase-admin"
import { historiasRadar } from "@/lib/radar/lectura"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Historias capturadas en los últimos 60 días: las propias con sus métricas, las de las semillas sin ellas.
export async function GET() {
  try {
    return NextResponse.json(await historiasRadar(createSupabaseAdmin()), { headers: { "Cache-Control": "private, max-age=60" } })
  } catch (e) {
    console.error("radar historias", e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
