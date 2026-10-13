import { NextResponse } from "next/server"
import { BRAND } from "@/lib/brand"
import { createSupabaseAdmin } from "@/lib/supabase-admin"
import { datosRadar } from "@/lib/radar/lectura"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Lo que alimenta las pestañas Semana, Grilla, Semillas y Comentarios: las piezas de los últimos 30 días
// con sus métricas derivadas, las cuentas y la minería de comentarios de la semana. "marca" es el nombre
// del negocio (lib/brand.ts) para los textos de la página ("Cómo recrear para …").
export async function GET() {
  try {
    const datos = await datosRadar(createSupabaseAdmin())
    return NextResponse.json({ ...datos, marca: BRAND.name }, { headers: { "Cache-Control": "private, max-age=60" } })
  } catch (e) {
    console.error("radar datos", e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
