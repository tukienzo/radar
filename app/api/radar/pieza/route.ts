import { NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase-admin"
import { detallePieza } from "@/lib/radar/lectura"

export const dynamic = "force-dynamic"

// El detalle de una pieza (transcript, slides leídas, recreación): se pide al abrirla, no viaja en la grilla.
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id") || ""
    if (!/^[a-z]{2}_[A-Za-z0-9_-]{5,40}$/.test(id)) return NextResponse.json({ error: "Pieza inválida" }, { status: 400 })
    const d = await detallePieza(createSupabaseAdmin(), id)
    return d ? NextResponse.json(d) : NextResponse.json({ error: "No existe la pieza" }, { status: 404 })
  } catch (e) {
    console.error("radar pieza", e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
