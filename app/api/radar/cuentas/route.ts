import { NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase-admin"
import { cuentaAFondo, indiceCuentas } from "@/lib/radar/lectura"
import { limpiarHandle } from "@/lib/radar/ingesta"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// Sin parámetros: el índice de cuentas con piezas en el período. Con ?handle=: esa cuenta a fondo.
export async function GET(request: Request) {
  try {
    const db = createSupabaseAdmin()
    const handle = limpiarHandle(new URL(request.url).searchParams.get("handle"))
    if (!handle) return NextResponse.json(await indiceCuentas(db))
    const c = await cuentaAFondo(db, handle)
    return c ? NextResponse.json(c) : NextResponse.json({ error: "No existe la cuenta" }, { status: 404 })
  } catch (e) {
    console.error("radar cuentas", e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
