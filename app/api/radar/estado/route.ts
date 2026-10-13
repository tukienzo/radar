import { NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase-admin"
import { estadoRadar } from "@/lib/radar/lectura"
import { usuarioActual } from "@/lib/sesion"

export const dynamic = "force-dynamic"

const GESTION = ["admin"]

// Qué está conectado (Apify, Claude, Instagram propio, transcripción), las últimas corridas y si quien mira puede gestionar.
export async function GET() {
  try {
    const u = await usuarioActual()
    if (!u) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
    return NextResponse.json({ ...(await estadoRadar(createSupabaseAdmin())), yo: { nombre: u.nombre, rol: u.rol, gestiona: GESTION.includes(u.rol) } })
  } catch (e) {
    console.error("radar estado", e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
