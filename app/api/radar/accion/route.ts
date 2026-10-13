import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createSupabaseAdmin } from "@/lib/supabase-admin"
import { usuarioActual } from "@/lib/sesion"
import { analizarPieza, armarDossier, claudeListo, Rechazo, recrearPieza, usoVacio } from "@/lib/radar/analisis"
import { correrPaso, esPaso } from "@/lib/radar/ciclo"
import { leerBanco } from "@/lib/radar/contexto"
import { limpiarHandle } from "@/lib/radar/ingesta"
import { cuentaAFondo, detallePieza } from "@/lib/radar/lectura"
import { baselines } from "@/lib/radar/metricas"
import type { Pieza, Semilla } from "@/lib/radar/tipos"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// Acciones que se disparan a mano desde la página del Radar (dirección y marketing):
//   sincronizar { paso }        corre un paso del Radar ahora (ver lib/radar/ciclo.ts)
//   analizar    { id }          vuelve a analizar una pieza
//   recrear     { id }          genera la versión propia de una pieza (para la marca del CRM)
//   dossier     { handle }      genera el dossier de una cuenta

const GESTION = ["admin"]
const error = (mensaje: string, status: number) => NextResponse.json({ error: mensaje }, { status })
const SIN_CLAUDE = "Falta ANTHROPIC_API_KEY en el servidor"

function mensajeClaude(e: unknown) {
  if (e instanceof Rechazo) return { mensaje: `Claude no quiso procesar esta pieza${e.categoria ? ` (${e.categoria})` : ""}.`, status: 422 }
  if (e instanceof Anthropic.AuthenticationError) return { mensaje: "La clave de Claude no es válida.", status: 502 }
  if (e instanceof Anthropic.RateLimitError) return { mensaje: "Claude está limitando los pedidos. Probá en un minuto.", status: 429 }
  if (e instanceof Anthropic.BadRequestError) return { mensaje: `Claude rechazó el pedido: ${e.message}`, status: 502 }
  if (e instanceof Anthropic.APIError) return { mensaje: `Claude respondió con error ${e.status ?? ""}. Probá de nuevo.`, status: 502 }
  return { mensaje: (e as Error).message, status: 500 }
}


export async function POST(request: Request) {
  const u = await usuarioActual()
  if (!u) return error("No autenticado", 401)
  if (!GESTION.includes(u.rol)) return error("Solo dirección y marketing pueden hacer esto", 403)
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return error("Pedido inválido", 400) }
  const db = createSupabaseAdmin()
  const accion = String(body.accion || "")

  try {
    if (accion === "sincronizar") {
      const paso = body.paso
      if (!esPaso(paso)) return error("Paso inválido", 400)
      const cuentas = Array.isArray(body.cuentas) ? body.cuentas.map(limpiarHandle).filter(Boolean) : undefined
      return NextResponse.json({ paso, ...(await correrPaso(db, paso, { pedidaPor: u.nombre || u.email, segundos: 240, cuentas, dias: Number(body.dias) || undefined })) })
    }

    if (accion === "analizar" || accion === "recrear") {
      const id = String(body.id || "")
      const { data: fila } = await db.from("radar_piezas").select("*").eq("id", id).maybeSingle()
      if (!fila) return error("No existe la pieza", 404)
      const pieza = fila as Pieza

      if (accion === "analizar") {
        if (!claudeListo()) return error(SIN_CLAUDE, 412)
        const [banco, semilla, historia] = await Promise.all([
          leerBanco(db),
          db.from("radar_semillas").select("*").eq("handle", pieza.cuenta_fuente).maybeSingle().then((r) => (r.data as Semilla | null) || undefined),
          db.from("radar_piezas").select("id,cuenta_fuente,fecha,views,likes,comentarios,fijado").eq("cuenta_fuente", pieza.cuenta_fuente).order("fecha", { ascending: false }).limit(60).then((r) => (r.data || []) as Pieza[]),
        ])
        const r = await analizarPieza(pieza, semilla, baselines(historia).get(pieza.cuenta_fuente)?.med_views ?? null, banco, usoVacio())
        const cambios: Record<string, unknown> = { analisis: r.analisis, objetivo: r.objetivo, analisis_at: new Date().toISOString(), analisis_error: null }
        if (r.guion) cambios.guion = r.guion
        if (r.lectura) cambios.lectura = r.lectura
        if (r.slides) cambios.slides = r.slides
        await db.from("radar_piezas").update(cambios).eq("id", id)
        return NextResponse.json({ ok: true, pieza: await detallePieza(db, id) })
      }

      if (accion === "recrear") {
        if (!claudeListo()) return error(SIN_CLAUDE, 412)
        if (!pieza.analisis) return error("Primero hay que analizar la pieza", 409)
        const recreacion = await recrearPieza(pieza, await leerBanco(db), usoVacio())
        await db.from("radar_piezas").update({ recreacion, recreacion_at: new Date().toISOString() }).eq("id", id)
        return NextResponse.json({ ok: true, pieza: await detallePieza(db, id) })
      }

      return error("Acción inválida", 400)
    }

    if (accion === "dossier") {
      if (!claudeListo()) return error(SIN_CLAUDE, 412)
      const handle = limpiarHandle(body.handle)
      const cuenta = handle ? await cuentaAFondo(db, handle) : null
      if (!cuenta) return error("No existe la cuenta", 404)
      if (cuenta.agregados.analizadas < 5) return error("Hacen falta al menos 5 piezas analizadas de los últimos 30 días para armar el dossier", 409)
      const resumen = {
        perfil: cuenta.perfil, historico: cuenta.historico,
        agregados: { ...cuenta.agregados, serie: undefined },
        piezas: cuenta.piezas.filter((p) => p.analisis).sort((x, y) => (y.comentarios ?? 0) - (x.comentarios ?? 0)).slice(0, 30).map((p) => ({
          id: p.id, tipo: p.tipo_media, fecha: p.fecha.slice(0, 10), comentarios: p.comentarios, views: p.views, veces_la_mediana_de_comentarios: p.outlier_com,
          formato: p.analisis?.formato, etapa: p.analisis?.tipo, hook: p.analisis?.hook_texto, patron: p.analisis?.hook_patron,
          keyword: p.analisis?.keyword, recurso: p.analisis?.recurso_prometido, por_que_pega: p.analisis?.por_que_pega, objetivo: p.objetivo?.objetivo,
        })),
      }
      const dossier = await armarDossier(handle, resumen, await leerBanco(db), usoVacio())
      // Una referencia que no corresponde a una pieza real se vacía, para que el link "ver original" no lleve a la nada.
      const ids = new Set(cuenta.piezas.map((p) => p.id))
      dossier.robar = dossier.robar.map((r) => ({ ...r, referencia_id: ids.has(r.referencia_id) ? r.referencia_id : "" }))
      await db.from("radar_semillas").update({ dossier, dossier_at: new Date().toISOString() }).eq("handle", handle)
      return NextResponse.json({ ok: true, dossier })
    }

    return error("Acción inválida", 400)
  } catch (e) {
    console.error("radar accion", accion, e)
    const m = mensajeClaude(e)
    return error(m.mensaje, m.status)
  }
}
