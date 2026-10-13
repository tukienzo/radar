// Publicaciones propias por la Graph API de Instagram: lista los reels y posts de la cuenta con su miniatura y lee sus
// métricas reales (alcance, vistas, guardados, compartidos, interacciones, tiempo de visualización, visitas al perfil y
// seguidores ganados). Gratis y completo: reemplaza a Apify para la cuenta propia. Los comentarios no traen el usuario
// sin el permiso instagram_manage_comments, así que el cruce de comentaristas de la Ciudad sigue por Apify.

import type { SupabaseClient } from "@supabase/supabase-js"
import { get, graphListo, resolverCuenta } from "./graph"

type DB = SupabaseClient
type J = Record<string, unknown>

// Instagram acepta métricas distintas según el producto: pedir una no soportada hace fallar la llamada entera
const METRICAS: Record<string, string[]> = {
  REELS: ["reach", "views", "saved", "shares", "total_interactions", "likes", "comments", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"],
  FEED: ["reach", "views", "saved", "shares", "total_interactions", "likes", "comments", "profile_visits", "follows"],
}
const TIPO: Record<string, string> = { CAROUSEL_ALBUM: "carrusel", VIDEO: "reel", IMAGE: "post" }
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null)

async function metricas(host: string, mediaId: string, producto: string) {
  const lista = METRICAS[producto] || METRICAS.FEED
  const out: Record<string, number> = {}
  const anotar = (r: J) => { for (const d of (r.data as J[] | undefined) || []) { const v = ((d.values as J[] | undefined) || [])[0]?.value; if (typeof v === "number") out[String(d.name)] = v } }
  const todas = await get(host, `${mediaId}/insights`, { metric: lista.join(",") })
  if (todas.error) for (const m of lista) anotar(await get(host, `${mediaId}/insights`, { metric: m }))
  else anotar(todas)
  return out
}

export async function sincronizarMediaPropia(db: DB, o: { dias?: number; hasta?: number } = {}) {
  if (!graphListo()) return { ok: false, motivo: "falta IG_INSIGHTS_TOKEN" }
  const hasta = o.hasta || Date.now() + 200000
  const desde = Date.now() - (o.dias || 60) * 864e5
  const cuenta = await resolverCuenta()
  const handle = cuenta.usuario.toLowerCase()

  // 1) lista de publicaciones (más nuevas primero) hasta la fecha de corte
  const media: J[] = []
  let despues = ""
  for (let pagina = 0; pagina < 10; pagina++) {
    const r = await get(cuenta.host, `${cuenta.id}/media`, { fields: "id,shortcode,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url,media_url", limit: "50", ...(despues ? { after: despues } : {}) })
    if (r.error) throw new Error(`media: ${r.error}`)
    const datos = (r.data as J[] | undefined) || []
    media.push(...datos.filter((m) => new Date(String(m.timestamp)).getTime() >= desde))
    const sig = ((r.paging as J | undefined)?.cursors as J | undefined)?.after
    if (!sig || !datos.length || new Date(String(datos[datos.length - 1].timestamp)).getTime() < desde) break
    despues = String(sig)
  }

  // 2) las piezas que el radar no tenía se dan de alta (el ciclo baja la miniatura)
  const ids = media.map((m) => `ig_${m.shortcode}`)
  const ya = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("radar_piezas").select("id").in("id", ids.slice(i, i + 200))
    for (const r of data || []) ya.add(String(r.id))
  }
  const nuevas = media.filter((m) => !ya.has(`ig_${m.shortcode}`)).map((m) => ({
    id: `ig_${m.shortcode}`, plataforma: "ig", cuenta: handle, cuenta_fuente: handle, url: String(m.permalink),
    tipo_media: m.media_product_type === "REELS" ? "reel" : TIPO[String(m.media_type)] || "post",
    fecha: new Date(String(m.timestamp)).toISOString(), caption: m.caption ? String(m.caption) : null,
    likes: n(m.like_count), comentarios: n(m.comments_count), thumb_remota: String(m.thumbnail_url || m.media_url || "") || null,
  }))
  if (nuevas.length) {
    const { error } = await db.from("radar_piezas").insert(nuevas)
    if (error) throw new Error(`alta de piezas: ${error.message}`)
  }

  // 3) métricas de cada publicación (y el historial de lecturas)
  const { data: previas } = await db.from("radar_piezas_metricas").select("pieza_id,historial").in("pieza_id", ids)
  const historial = new Map((previas || []).map((p) => [String(p.pieza_id), (p.historial as J[]) || []]))
  let leidas = 0, cortadas = 0
  for (const m of media) {
    if (Date.now() > hasta) { cortadas = media.length - leidas; break }
    const producto = String(m.media_product_type || "FEED")
    const v = await metricas(cuenta.host, String(m.id), producto)
    const id = `ig_${m.shortcode}`
    const ahora = new Date().toISOString()
    const fila = {
      pieza_id: id, media_id: String(m.id), producto,
      alcance: n(v.reach), vistas: n(v.views), guardados: n(v.saved), compartidos: n(v.shares), interacciones: n(v.total_interactions),
      likes: n(v.likes ?? m.like_count), comentarios: n(v.comments ?? m.comments_count),
      visitas_perfil: n(v.profile_visits), seguidores: n(v.follows),
      tiempo_promedio_ms: n(v.ig_reels_avg_watch_time), tiempo_total_ms: n(v.ig_reels_video_view_total_time),
      historial: [...(historial.get(id) || []), { t: ahora, alcance: n(v.reach), vistas: n(v.views) }].slice(-40),
      leido_at: ahora,
    }
    const { error } = await db.from("radar_piezas_metricas").upsert(fila, { onConflict: "pieza_id" })
    if (error) throw new Error(`métricas: ${error.message}`)
    await db.from("radar_piezas").update({ likes: fila.likes, comentarios: fila.comentarios, views: fila.vistas, medido_at: ahora }).eq("id", id)
    leidas++
  }
  return { ok: true, cuenta: `@${handle}`, publicaciones: media.length, nuevas: nuevas.length, leidas, cortadas }
}
