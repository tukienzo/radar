// Lo que leen las rutas /api/radar/*: trae las filas de la base y arma lo que espera la página.

import type { SupabaseClient } from "@supabase/supabase-js"
import { apifyListo, ACTORES, planRadar, presupuesto } from "./apify"
import { claudeListo, MODELO } from "./analisis"
import { DIMENSIONES, OBJETIVOS, ROLES } from "./esquema-guion"
import { graphListo } from "./graph"
import { construirDatos, local, urlPublica, VENTANA_DIAS, vistaCuenta, vistaGuion, vistaHistorias } from "./metricas"
import { motorTranscripcion } from "./transcribir"
import type { Corrida, Historia, Pieza, Semilla } from "./tipos"

type DB = SupabaseClient
const DIA = 864e5

// Columnas livianas: las que hacen falta para las cuentas y la grilla. Lo pesado (transcript, guion,
// recreación) se pide recién al abrir una pieza.
const LIVIANAS = "id,plataforma,cuenta,cuenta_fuente,url,tipo_media,fecha,caption,likes,comentarios,views,duracion,fijado,thumb_path,analisis,objetivo,visto_at,medido_at"

async function todas<T>(armar: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const out: T[] = []
  for (let k = 0; k < 20000; k += 1000) {
    const { data, error } = await armar(k, k + 999)
    if (error) throw new Error(error.message)
    const lote = (data || []) as T[]
    out.push(...lote)
    if (lote.length < 1000) break
  }
  return out
}

export async function leerSemillas(db: DB) {
  const { data, error } = await db.from("radar_semillas").select("*").order("handle")
  if (error) throw new Error(error.message)
  return (data || []) as Semilla[]
}

const hora = (f: string | null | undefined) => {
  if (!f) return null
  const l = local(f)
  return `${l.dia} ${String(l.hora).padStart(2, "0")}:${String(new Date(f).getUTCMinutes()).padStart(2, "0")} ART`
}

export async function datosRadar(db: DB, ahora = new Date()) {
  // 120 días: la ventana que se muestra (30) más el histórico que hace falta para la mediana de cada cuenta.
  const desde = new Date(ahora.getTime() - 120 * DIA).toISOString()
  const [semillas, livianas, banderas, comentarios, corrida] = await Promise.all([
    leerSemillas(db),
    todas<Pieza>((a, b) => db.from("radar_piezas").select(LIVIANAS).gte("fecha", desde).order("fecha", { ascending: false }).range(a, b)),
    // Qué piezas del período tienen transcript, slides o recreación, sin traer el contenido.
    todas<{ id: string; t: boolean; s: number; r: boolean }>((a, b) => db.rpc("radar_banderas", { desde: new Date(ahora.getTime() - VENTANA_DIAS * DIA).toISOString() }).range(a, b)),
    db.from("radar_comentarios").select("*").order("semana", { ascending: false }).limit(1).maybeSingle(),
    db.from("radar_corridas").select("terminado").eq("tipo", "piezas").eq("estado", "recogida").order("terminado", { ascending: false }).limit(1).maybeSingle(),
  ])
  const flags = new Map(banderas.map((f) => [f.id, f]))
  const piezas = livianas.map((p) => {
    const f = flags.get(p.id)
    return { ...p, transcript: f?.t ? "1" : null, slides: f?.s ? Array.from({ length: f.s }, (_, k) => ({ n: k + 1, path: "" })) : null, recreacion: f?.r ? ({} as Pieza["recreacion"]) : null } as Pieza
  })
  const c = comentarios.data as { semana: string; n_comentarios: number; resultado: Record<string, unknown> } | null
  return construirDatos({
    piezas, semillas, ahora,
    comentarios: c ? ({ ...(c.resultado as object), n_comentarios: c.n_comentarios, semana: c.semana } as Parameters<typeof construirDatos>[0]["comentarios"]) : null,
    corte: hora((corrida.data as { terminado: string } | null)?.terminado),
    fuentes: { piezas: `Apify (${ACTORES.piezas().replace("~", "/")})`, comentarios: `Apify (${ACTORES.comentarios().replace("~", "/")})`, analisis: MODELO() },
  })
}

export async function detallePieza(db: DB, id: string) {
  const { data, error } = await db.from("radar_piezas").select("id,transcript,slides,lectura,recreacion,guion,duracion,analisis,objetivo,analisis_error,transcript_error").eq("id", id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  // Las slides importadas de la semilla traen el texto leído pero no la imagen (path vacío): el texto se muestra igual.
  const todas = (data.slides || []) as Array<{ n: number; path?: string | null; texto?: string; visual?: string }>
  const conImagen = todas.every((s) => s.path)
  return {
    id: data.id, transcript: data.transcript || "", duracion: data.duracion,
    slides_local: conImagen ? todas.map((s) => urlPublica(String(s.path))) : [], slides_texto: todas.map((s) => ({ n: s.n, texto: s.texto || "", visual: s.visual || "" })),
    lectura: data.lectura, recreacion: data.recreacion, analisis: data.analisis, objetivo: data.objetivo,
    analisis_error: data.analisis_error, transcript_error: data.transcript_error,
  }
}

export async function indiceCuentas(db: DB, ahora = new Date()) {
  const desde = new Date(ahora.getTime() - VENTANA_DIAS * DIA).toISOString()
  const [semillas, filas] = await Promise.all([
    leerSemillas(db),
    todas<{ cuenta_fuente: string }>((a, b) => db.from("radar_piezas").select("cuenta_fuente").gte("fecha", desde).range(a, b)),
  ])
  const n = new Map<string, number>()
  for (const f of filas) n.set(f.cuenta_fuente, (n.get(f.cuenta_fuente) || 0) + 1)
  return Object.fromEntries(semillas.filter((s) => n.get(s.handle)).map((s) => [s.handle, { handle: s.handle, dias: VENTANA_DIAS, n: n.get(s.handle), generado: ahora.toISOString(), dossier: Boolean(s.dossier) }]))
}

export async function cuentaAFondo(db: DB, handle: string, ahora = new Date()) {
  const { data: semilla, error } = await db.from("radar_semillas").select("*").eq("handle", handle).maybeSingle()
  if (error) throw new Error(error.message)
  if (!semilla) return null
  const historia = await todas<Pieza>((a, b) => db.from("radar_piezas").select(`${LIVIANAS},transcript,slides,slides_remotas,recreacion`).eq("cuenta_fuente", handle).order("fecha", { ascending: false }).range(a, b))
  return vistaCuenta(semilla as Semilla, historia, ahora)
}

export async function guionRadar(db: DB, soloPasajes = false, ahora = new Date()) {
  const reels = await todas<Pieza>((a, b) => db.from("radar_piezas").select("id,cuenta,cuenta_fuente,url,tipo_media,fecha,views,likes,comentarios,thumb_path,transcript,guion,objetivo").eq("tipo_media", "reel").not("guion", "is", null).order("fecha", { ascending: false }).range(a, b))
  if (soloPasajes) return vistaGuion(reels, new Map()).pasajes
  // Leads por keyword: usuarios distintos que comentaron la palabra clave, en las piezas de las que se bajaron comentarios.
  const conKeyword = reels.filter((p) => p.objetivo?.keyword)
  const keywords = new Map<string, { kc: number; ku: number }>()
  if (conKeyword.length) {
    const crudos = await todas<{ pieza_id: string; usuario: string | null; texto: string }>((a, b) => db.from("radar_comentarios_crudos").select("pieza_id,usuario,texto").in("pieza_id", conKeyword.map((p) => p.id).slice(0, 300)).range(a, b))
    const porPieza = new Map<string, Array<{ usuario: string | null; texto: string }>>()
    for (const c of crudos) { const l = porPieza.get(c.pieza_id) || []; l.push(c); porPieza.set(c.pieza_id, l) }
    for (const p of conKeyword) {
      const l = porPieza.get(p.id)
      if (!l?.length) continue
      const kw = String(p.objetivo?.keyword || "").toLowerCase()
      const con = l.filter((c) => c.texto.toLowerCase().includes(kw))
      keywords.set(p.id, { kc: con.length, ku: new Set(con.map((c) => c.usuario || c.texto)).size })
    }
  }
  return { generado: ahora.toISOString(), dims: DIMENSIONES, roles: ROLES, objetivos: OBJETIVOS, cuentas: vistaGuion(reels, keywords).cuentas }
}

export async function historiasRadar(db: DB, ahora = new Date()) {
  const desde = new Date(ahora.getTime() - 60 * DIA).toISOString()
  const [historias, ultima] = await Promise.all([
    todas<Historia>((a, b) => db.from("radar_historias").select("id,cuenta,fecha,tipo,dur,caption,tx,stickers,frame_path,url,metricas,metricas_at,lectura,fuente").gte("fecha", desde).order("fecha", { ascending: false }).range(a, b)),
    db.from("radar_corridas").select("terminado,costo_usd").eq("tipo", "historias").eq("estado", "recogida").order("terminado", { ascending: false }).limit(1).maybeSingle(),
  ])
  return vistaHistorias(historias, ultima.data as { terminado: string | null; costo_usd: number | null } | null, ahora)
}

// Qué está conectado y cómo vienen las corridas: lo usa el encabezado de la página para avisar qué falta.
export async function estadoRadar(db: DB) {
  const [corridas, pendientes, gasto, apify] = await Promise.all([
    db.from("radar_corridas").select("*").order("iniciado", { ascending: false }).limit(12),
    db.from("radar_piezas").select("id", { count: "exact", head: true }).is("analisis", null).is("analisis_error", null).gte("fecha", new Date(Date.now() - VENTANA_DIAS * DIA).toISOString()),
    db.from("radar_corridas").select("costo_usd").gte("iniciado", new Date(Date.now() - 30 * DIA).toISOString()).not("costo_usd", "is", null),
    apifyListo() ? presupuesto() : Promise.resolve(null),
  ])
  return {
    conexiones: {
      apify: apifyListo(),
      claude: claudeListo(),
      instagram_propio: graphListo(),
      transcripcion: motorTranscripcion()?.nombre || null,
    },
    modelo: MODELO(),
    plan: planRadar(),
    apify,
    actores: { piezas: ACTORES.piezas(), perfiles: ACTORES.perfiles(), historias: ACTORES.historias(), comentarios: ACTORES.comentarios() },
    sin_analizar: pendientes.count ?? 0,
    gasto_apify_30d: Math.round(((gasto.data || []) as Array<{ costo_usd: number }>).reduce((t, c) => t + Number(c.costo_usd || 0), 0) * 100) / 100,
    corridas: ((corridas.data || []) as Corrida[]).map((c) => ({ id: c.id, tipo: c.tipo, estado: c.estado, cuentas: c.cuentas?.length || 0, items: c.items, nuevos: c.nuevos, costo_usd: c.costo_usd, error: c.error, pedida_por: c.pedida_por, iniciado: c.iniciado, terminado: c.terminado })),
  }
}
