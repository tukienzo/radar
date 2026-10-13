// Historias de la cuenta propia por la Graph API de Instagram: es la única fuente con métricas (alcance,
// respuestas, salidas, avances). Las historias solo se pueden leer mientras están activas, así que esto
// corre cada pocas horas y guarda la última lectura antes de que venzan.
//
// Variables: IG_INSIGHTS_TOKEN (token con instagram_basic + instagram_manage_insights, o los equivalentes
// instagram_business_* si es "Instagram API with Instagram Login") · IG_USER_ID (opcional).

import type { SupabaseClient } from "@supabase/supabase-js"
import type { MetricasHistoria } from "./tipos"

type DB = SupabaseClient
type J = Record<string, unknown>
const V = "v21.0"
const METRICAS = ["views", "reach", "replies", "shares", "total_interactions", "follows", "profile_visits"]

export const graphListo = () => Boolean((process.env.IG_INSIGHTS_TOKEN || "").trim())

export async function get(host: string, path: string, params: Record<string, string>): Promise<J> {
  const q = new URLSearchParams({ ...params, access_token: (process.env.IG_INSIGHTS_TOKEN || "").trim() })
  try {
    const r = await fetch(`https://${host}/${V}/${path}?${q}`, { cache: "no-store", signal: AbortSignal.timeout(30000) })
    const j = (await r.json()) as J
    if (!r.ok) return { error: String((j.error as J | undefined)?.message || `http ${r.status}`) }
    return j
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// Prueba primero Instagram Login (graph.instagram.com) y después Facebook Login (graph.facebook.com).
export async function resolverCuenta() {
  const yo = await get("graph.instagram.com", "me", { fields: "user_id,username,followers_count" })
  if (!yo.error && yo.user_id) return { host: "graph.instagram.com", id: String(yo.user_id), usuario: String(yo.username || ""), seguidores: Number(yo.followers_count) || null }
  const fijo = (process.env.IG_USER_ID || "").trim()
  if (fijo) {
    const r = await get("graph.facebook.com", fijo, { fields: "id,username,followers_count" })
    if (!r.error) return { host: "graph.facebook.com", id: fijo, usuario: String(r.username || ""), seguidores: Number(r.followers_count) || null }
  }
  const paginas = await get("graph.facebook.com", "me/accounts", { fields: "id,name,instagram_business_account{id,username,followers_count}" })
  for (const p of (paginas.data as J[] | undefined) || []) {
    const ig = p.instagram_business_account as J | undefined
    if (ig?.id) return { host: "graph.facebook.com", id: String(ig.id), usuario: String(ig.username || ""), seguidores: Number(ig.followers_count) || null }
  }
  throw new Error(`No se encontró la cuenta de Instagram con este token: ${String(yo.error || paginas.error || "sin cuentas asociadas")}`)
}

async function insights(host: string, mediaId: string) {
  const out: Record<string, number> = {}
  const anotar = (r: J) => { for (const d of (r.data as J[] | undefined) || []) { const v = ((d.values as J[] | undefined) || [])[0]?.value; if (typeof v === "number") out[String(d.name)] = v } }
  const todas = await get(host, `${mediaId}/insights`, { metric: METRICAS.join(",") })
  if (todas.error) for (const m of METRICAS) anotar(await get(host, `${mediaId}/insights`, { metric: m }))   // alguna no soportada: de a una
  else anotar(todas)
  const nav = await get(host, `${mediaId}/insights`, { metric: "navigation", breakdown: "story_navigation_action_type" })
  for (const d of (nav.data as J[] | undefined) || []) {
    const total = d.total_value as J | undefined
    for (const b of (total?.breakdowns as J[] | undefined) || [])
      for (const fila of (b.results as J[] | undefined) || []) out[`nav_${((fila.dimension_values as string[]) || []).join("_")}`] = Number(fila.value) || 0
  }
  return out
}

const valor = (v: number | undefined) => (typeof v === "number" ? v : null)

export async function sincronizarPropias(db: DB) {
  if (!graphListo()) return { ok: false, motivo: "falta IG_INSIGHTS_TOKEN" }
  const cuenta = await resolverCuenta()
  const handle = cuenta.usuario.toLowerCase()
  const lista = await get(cuenta.host, `${cuenta.id}/stories`, { fields: "id,media_type,media_product_type,timestamp,permalink,caption,media_url,thumbnail_url" })
  if (lista.error) throw new Error(`stories: ${String(lista.error)}`)
  const activas = ((lista.data as J[] | undefined) || [])
  if (handle) {
    await db.from("radar_semillas").upsert({ handle, tags: ["propia"], nota: "cuenta propia: baseline, no se recrea", creado_por: "graph" }, { onConflict: "handle", ignoreDuplicates: true })
    if (cuenta.seguidores) await db.from("radar_semillas").update({ seguidores: cuenta.seguidores, perfil_at: new Date().toISOString() }).eq("handle", handle)
  }
  let nuevas = 0
  for (const s of activas) {
    const id = String(s.id)
    const m = await insights(cuenta.host, id)
    const alcance = valor(m.reach)
    const metricas: MetricasHistoria = {
      alcance, views: valor(m.views), respuestas: valor(m.replies), shares: valor(m.shares), visitas: valor(m.profile_visits), follows: valor(m.follows),
      salidas: valor(m.nav_tap_exit), avances: valor(m.nav_tap_forward), retrocesos: valor(m.nav_tap_back),
      salida_pct: alcance && typeof m.nav_tap_exit === "number" ? Math.round((m.nav_tap_exit / alcance) * 1000) / 10 : null,
      resp_k: alcance && typeof m.replies === "number" ? Math.round((m.replies / alcance) * 10000) / 10 : null,
    }
    const fecha = new Date(String(s.timestamp || "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))
    if (Number.isNaN(fecha.getTime())) continue
    const esVideo = String(s.media_type) === "VIDEO"
    const { data: previa } = await db.from("radar_historias").select("id,frame_path").eq("id", id).maybeSingle()
    if (previa) {
      await db.from("radar_historias").update({ metricas, metricas_at: new Date().toISOString() }).eq("id", id)
      continue
    }
    const video = esVideo ? (s.media_url as string | undefined) || null : null
    const { error } = await db.from("radar_historias").insert({
      id, cuenta: handle, fecha: fecha.toISOString(), vence: new Date(fecha.getTime() + 864e5).toISOString(), tipo: esVideo ? "video" : "foto",
      caption: typeof s.caption === "string" ? s.caption : null, stickers: {},
      frame_remota: (esVideo ? s.thumbnail_url : s.media_url) as string | undefined || null,
      video_url: video, video_url_at: video ? new Date().toISOString() : null,
      url: (s.permalink as string | undefined) || null, metricas, metricas_at: new Date().toISOString(), fuente: "graph",
    })
    if (!error) nuevas += 1
  }
  await db.from("radar_corridas").insert({ tipo: "propias", estado: "recogida", actor: "graph-api", cuentas: handle ? [handle] : [], items: activas.length, nuevos: nuevas, costo_usd: 0, pedida_por: "cron", terminado: new Date().toISOString() })
  return { ok: true, cuenta: handle, activas: activas.length, nuevas }
}
