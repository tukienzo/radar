// Ingesta del Radar: qué se le pide a Apify y cómo se traduce lo que devuelve a las tablas radar_*.
//
// Dos tiempos, porque una corrida de Apify tarda minutos y una función no puede quedarse esperando:
//   lanzar*()  → arranca la corrida y deja una fila en radar_corridas (estado "lanzada")
//   recoger()  → mira las corridas lanzadas; las que terminaron las lee, las guarda y las cierra
// Las imágenes no se bajan acá: queda la url en *_remota y las baja lib/radar/medios.ts.

import type { SupabaseClient } from "@supabase/supabase-js"
import { BRAND } from "@/lib/brand"
import { ACTORES, lanzarActor, leerCorrida, leerItems, TERMINADA_MAL } from "./apify"
import type { Corrida, Semilla, Stickers, TipoMedia } from "./tipos"

type Item = Record<string, unknown>
type DB = SupabaseClient

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null }
const dec = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }
const iso = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" || /^\d+$/.test(String(v)) ? Number(v) : NaN
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const primero = (...vs: unknown[]) => vs.find((v) => v !== null && v !== undefined && v !== "")
export const limpiarHandle = (v: unknown) =>
  String(v || "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/^@/, "").split(/[/?#]/)[0].replace(/[^a-z0-9._]/g, "")

export async function semillasActivas(db: DB) {
  const { data, error } = await db.from("radar_semillas").select("*").eq("activa", true)
  if (error) throw new Error(error.message)
  return (data || []) as Semilla[]
}

async function registrar(db: DB, fila: Partial<Corrida>) {
  const { data, error } = await db.from("radar_corridas").insert(fila).select("*").single()
  if (error) throw new Error(error.message)
  return data as Corrida
}

// No se lanza otra corrida del mismo tipo si hay una andando: evita pagar dos veces por el mismo pedido.
async function enCurso(db: DB, tipo: Corrida["tipo"]) {
  const { data } = await db.from("radar_corridas").select("id").eq("tipo", tipo).eq("estado", "lanzada").gte("iniciado", new Date(Date.now() - 2 * 3600e3).toISOString()).limit(1)
  return Boolean(data?.length)
}

// ── Lanzar ──────────────────────────────────────────────────────────────────────

// Piezas: las publicaciones de los últimos `dias` de cada semilla (hasta `porCuenta` por cuenta).
// Cada pieza se vuelve a leer mientras esté dentro de esa ventana, así las métricas se mantienen al día.
export async function lanzarPiezas(db: DB, o: { dias?: number; porCuenta?: number; pedidaPor?: string; cuentas?: string[] } = {}) {
  if (await enCurso(db, "piezas")) return { ok: false, motivo: "ya hay una corrida de piezas en curso" }
  const semillas = (await semillasActivas(db)).filter((s) => !o.cuentas?.length || o.cuentas.includes(s.handle))
  if (!semillas.length) return { ok: false, motivo: "no hay cuentas activas" }
  const dias = o.dias || Number(process.env.RADAR_DIAS_PIEZAS || 7)
  const porCuenta = o.porCuenta || Number(process.env.RADAR_PIEZAS_POR_CUENTA || 15)
  const actor = ACTORES.piezas()
  const run = await lanzarActor(actor, {
    directUrls: semillas.map((s) => `https://www.instagram.com/${s.handle}/`),
    resultsType: "posts",
    resultsLimit: porCuenta,
    onlyPostsNewerThan: `${dias} days`,
    addParentData: false,
  })
  const corrida = await registrar(db, { tipo: "piezas", actor, apify_run_id: run.id, apify_dataset_id: run.defaultDatasetId, cuentas: semillas.map((s) => s.handle), pedida_por: o.pedidaPor || "cron", detalle: { dias, porCuenta } })
  return { ok: true, corrida: corrida.id, cuentas: semillas.length }
}

// Reels de la cuenta propia: la lectura de "posts" del perfil trae solo la primera página (unos 12, casi todos
// carruseles); los reels se piden por la pestaña de reels. La Ciudad los usa para mostrar la miniatura de cada pieza.
// La cuenta propia es NEXT_PUBLIC_BRAND_IG_HANDLE (BRAND.igHandle): sin ella no se lee nada.
export async function lanzarReelsPropios(db: DB, o: { handle?: string; dias?: number; limite?: number; pedidaPor?: string } = {}) {
  const handle = limpiarHandle(o.handle) || BRAND.igHandle
  if (!handle) return { ok: false, motivo: "no hay cuenta propia configurada (NEXT_PUBLIC_BRAND_IG_HANDLE): no se leen reels propios" }
  if (await enCurso(db, "piezas")) return { ok: false, motivo: "ya hay una corrida de piezas en curso" }
  const actor = ACTORES.piezas()
  const run = await lanzarActor(actor, {
    directUrls: [`https://www.instagram.com/${handle}/reels/`],
    resultsType: "reels",
    resultsLimit: o.limite || 12,
    onlyPostsNewerThan: `${o.dias || 4} days`,
    addParentData: false,
  })
  const corrida = await registrar(db, { tipo: "piezas", actor, apify_run_id: run.id, apify_dataset_id: run.defaultDatasetId, cuentas: [handle], pedida_por: o.pedidaPor || "cron", detalle: { resultsType: "reels", dias: o.dias || 4 } })
  return { ok: true, corrida: corrida.id }
}

export async function lanzarPerfiles(db: DB, o: { pedidaPor?: string } = {}) {
  if (await enCurso(db, "perfiles")) return { ok: false, motivo: "ya hay una corrida de perfiles en curso" }
  const semillas = await semillasActivas(db)
  if (!semillas.length) return { ok: false, motivo: "no hay cuentas activas" }
  const actor = ACTORES.perfiles()
  const run = await lanzarActor(actor, { usernames: semillas.map((s) => s.handle) }, { segundos: 900 })
  const corrida = await registrar(db, { tipo: "perfiles", actor, apify_run_id: run.id, apify_dataset_id: run.defaultDatasetId, cuentas: semillas.map((s) => s.handle), pedida_por: o.pedidaPor || "cron" })
  return { ok: true, corrida: corrida.id, cuentas: semillas.length }
}

// Historias de las cuentas que las tienen activadas. Las propias van por la Graph API (traen métricas);
// solo se piden por Apify si todavía no hay token de Instagram cargado.
export async function lanzarHistorias(db: DB, o: { pedidaPor?: string; incluirPropias?: boolean } = {}) {
  if (await enCurso(db, "historias")) return { ok: false, motivo: "ya hay una corrida de historias en curso" }
  const semillas = (await semillasActivas(db)).filter((s) => s.historias && (o.incluirPropias || !s.tags.includes("propia")))
  if (!semillas.length) return { ok: false, motivo: "no hay cuentas con historias activadas" }
  const actor = ACTORES.historias()
  const handles = semillas.map((s) => s.handle)
  // El formato de entrada depende del actor. RADAR_INPUT_HISTORIAS permite fijarlo sin tocar código:
  // un JSON donde "{{handles}}" se reemplaza por la lista y "{{urls}}" por las urls de los perfiles.
  const plantilla = process.env.RADAR_INPUT_HISTORIAS
  const input = plantilla
    ? JSON.parse(plantilla.replace(/"\{\{handles\}\}"/g, JSON.stringify(handles)).replace(/"\{\{urls\}\}"/g, JSON.stringify(handles.map((h) => `https://www.instagram.com/${h}/`))))
    : { usernames: handles }
  const run = await lanzarActor(actor, input, { segundos: 1200 })
  const corrida = await registrar(db, { tipo: "historias", actor, apify_run_id: run.id, apify_dataset_id: run.defaultDatasetId, cuentas: handles, pedida_por: o.pedidaPor || "cron" })
  return { ok: true, corrida: corrida.id, cuentas: handles.length }
}

// Comentarios de las piezas más comentadas de los últimos días (las de terceros y las propias).
// o.ids / o.cuenta: comentarios de piezas puntuales (la Ciudad los usa para saber qué post es cada pieza de ManyChat)
export async function lanzarComentarios(db: DB, o: { pedidaPor?: string; piezas?: number; porPieza?: number; dias?: number; cuenta?: string; ids?: string[] } = {}) {
  if (await enCurso(db, "comentarios")) return { ok: false, motivo: "ya hay una corrida de comentarios en curso" }
  const desde = new Date(Date.now() - (o.dias || 7) * 864e5).toISOString()
  let q = db.from("radar_piezas").select("id,url,comentarios")
  q = o.ids?.length ? q.in("id", o.ids) : q.gte("fecha", desde).gt("comentarios", 5)
  if (o.cuenta) q = q.eq("cuenta", o.cuenta)
  const { data, error } = await q.order("comentarios", { ascending: false }).limit(o.ids?.length || o.piezas || Number(process.env.RADAR_PIEZAS_COMENTARIOS || 15))
  if (error) throw new Error(error.message)
  if (!data?.length) return { ok: false, motivo: "no hay piezas con comentarios en el período" }
  const actor = ACTORES.comentarios()
  const run = await lanzarActor(actor, { directUrls: data.map((p) => p.url), resultsLimit: o.porPieza || Number(process.env.RADAR_COMENTARIOS_POR_PIEZA || 30) }, { segundos: 1500 })
  const corrida = await registrar(db, { tipo: "comentarios", actor, apify_run_id: run.id, apify_dataset_id: run.defaultDatasetId, cuentas: [], pedida_por: o.pedidaPor || "cron", detalle: { piezas: data.map((p) => p.id) } })
  return { ok: true, corrida: corrida.id, piezas: data.length }
}

// ── Traducir lo que devuelve Apify ─────────────────────────────────────────────

const tipoDe = (i: Item): TipoMedia => {
  const t = String(i.type || "").toLowerCase()
  if (t === "sidecar" || (Array.isArray(i.childPosts) && i.childPosts.length > 1)) return "carrusel"
  if (t === "video" || i.productType === "clips" || i.videoUrl) return "reel"
  return "post"
}

export function piezaDesdeApify(i: Item, semillas: Set<string>) {
  const codigo = txt(i.shortCode) || txt(String(i.url || "").match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/)?.[1])
  const fecha = iso(i.timestamp)
  const autor = limpiarHandle(i.ownerUsername)
  if (!codigo || !fecha || (!autor && !i.inputUrl)) return null
  const fuente = limpiarHandle(i.inputUrl) || autor
  // Si el perfil pedido no es una semilla (redirección, cuenta renombrada) se toma al autor como fuente.
  const cuentaFuente = semillas.has(fuente) ? fuente : semillas.has(autor) ? autor : fuente
  const tipo = tipoDe(i)
  const hijos = Array.isArray(i.childPosts) ? (i.childPosts as Item[]) : []
  const imagenes = Array.isArray(i.images) ? (i.images as unknown[]).map(txt).filter(Boolean) : []
  const slides = tipo === "carrusel" ? (hijos.length ? hijos.map((h) => txt(h.displayUrl)).filter(Boolean) : imagenes).slice(0, 12) : []
  const likes = Number(i.likesCount)
  const video = txt(i.videoUrl)
  return {
    id: `ig_${codigo}`,
    plataforma: "ig",
    cuenta: autor || cuentaFuente,
    cuenta_fuente: cuentaFuente,
    url: txt(i.url) || `https://www.instagram.com/p/${codigo}/`,
    tipo_media: tipo,
    fecha,
    caption: txt(i.caption),
    likes: Number.isFinite(likes) && likes >= 0 ? Math.round(likes) : null,   // -1 = el autor ocultó los likes
    comentarios: num(i.commentsCount),
    views: tipo === "reel" ? num(primero(i.videoPlayCount, i.videoViewCount)) : null,
    duracion: dec(i.videoDuration),
    fijado: Boolean(i.isPinned),
    thumb_remota: txt(i.displayUrl),
    slides_remotas: slides.length ? slides : null,
    video_url: video,
    video_url_at: video ? new Date().toISOString() : null,
    medido_at: new Date().toISOString(),
  }
}

export function perfilDesdeApify(i: Item) {
  const handle = limpiarHandle(primero(i.username, i.inputUrl))
  if (!handle) return null
  return {
    handle,
    nombre: txt(i.fullName),
    bio: txt(i.biography),
    seguidores: num(i.followersCount),
    posts: num(i.postsCount),
    foto_remota: txt(primero(i.profilePicUrlHD, i.profilePicUrl)),
    perfil_at: new Date().toISOString(),
  }
}

// Las historias llegan con nombres de campo distintos según el actor (algunos devuelven el objeto crudo de
// Instagram, otros uno ya aplanado), así que se busca cada dato en todas las variantes conocidas.
export function historiaDesdeApify(i: Item) {
  const usuario = (i.user || i.owner || {}) as Item
  const cuenta = limpiarHandle(primero(i.username, i.ownerUsername, usuario.username, i.user_name, i.inputUsername, i.profileUrl, i.inputUrl))
  const id = txt(String(primero(i.id, i.pk, i.storyId, i.story_id, i.mediaId, i.media_id, i.code) ?? ""))
  const fecha = iso(primero(i.taken_at, i.takenAt, i.taken_at_timestamp, i.timestamp, i.takenAtTimestamp, i.created_at, i.createdAt, i.publishedAt))
  if (!cuenta || !id || !fecha) return null
  const versiones = ((i.image_versions2 as Item)?.candidates || i.image_versions || []) as Item[]
  const videos = (i.video_versions || i.videoVersions || []) as Item[]
  const video = txt(primero(i.videoUrl, i.video_url, i.video, videos[0]?.url))
  const esVideo = Boolean(video) || Number(i.media_type) === 2 || /video/i.test(String(primero(i.type, i.mediaType, i.media_type) ?? ""))
  const frame = txt(primero(i.thumbnailUrl, i.thumbnail_url, i.thumbnail, i.displayUrl, i.display_url, i.imageUrl, i.image_url, i.image, versiones[0]?.url, esVideo ? null : i.url))
  const lista = (v: unknown) => (Array.isArray(v) ? (v as Item[]) : [])
  const links = [
    ...lista(i.story_link_stickers).map((s) => txt(((s.story_link as Item) || s).url)),
    ...lista(i.links).map((s) => txt(typeof s === "string" ? s : (s as Item).url)),
    txt((i.story_cta as Item[] | undefined)?.[0] && (((i.story_cta as Item[])[0].links as Item[] | undefined)?.[0]?.webUri)),
    txt(i.linkUrl), txt(i.link),
  ].filter(Boolean) as string[]
  const menciones = [
    ...lista(i.reel_mentions).map((s) => txt(((s.user as Item) || s).username)),
    ...lista(i.mentions).map((s) => txt(typeof s === "string" ? s : (s as Item).username)),
  ].filter(Boolean).map((u) => limpiarHandle(u)) as string[]
  const encuestas = [
    ...lista(i.story_polls).map((s) => txt(((s.poll_sticker as Item) || s).question)),
    ...lista(i.story_sliders).map((s) => txt(((s.slider_sticker as Item) || s).question)),
    ...lista(i.story_quizs).map((s) => txt(((s.quiz_sticker as Item) || s).question)),
    ...lista(i.polls).map((s) => txt(typeof s === "string" ? s : (s as Item).question)),
  ].filter(Boolean) as string[]
  const preguntas = [
    ...lista(i.story_questions).map((s) => txt(((s.question_sticker as Item) || s).question)),
    ...lista(i.questions).map((s) => txt(typeof s === "string" ? s : (s as Item).question)),
  ].filter(Boolean) as string[]
  const stickers: Stickers = {}
  if (links.length) stickers.links = [...new Set(links)]
  if (menciones.length) stickers.menciones = [...new Set(menciones)]
  if (encuestas.length) stickers.encuestas = encuestas
  if (preguntas.length) stickers.preguntas = preguntas
  if ((Array.isArray(i.story_music_stickers) && i.story_music_stickers.length) || i.music_metadata || i.is_story_image_with_music === true || i.is_music_collection_story === true || i.music) stickers.musica = true
  const caption = i.caption && typeof i.caption === "object" ? txt((i.caption as Item).text) : txt(primero(i.caption, i.text, i.accessibility_caption))
  return {
    id: String(id),
    cuenta,
    fecha,
    vence: iso(primero(i.expiring_at, i.expiringAt, i.expires_at)) || new Date(new Date(fecha).getTime() + 864e5).toISOString(),
    tipo: esVideo ? "video" : "foto",
    dur: dec(primero(i.video_duration, i.videoDuration, i.duration)),
    caption,
    stickers,
    frame_remota: frame,
    video_url: video,
    video_url_at: video ? new Date().toISOString() : null,
    url: txt(i.permalink) || (String(id).split("_")[0] ? `https://www.instagram.com/stories/${cuenta}/${String(id).split("_")[0]}/` : null),
    fuente: "apify",
  }
}

export function comentarioDesdeApify(i: Item, piezasPorUrl: Map<string, { id: string; cuenta: string }>) {
  const texto = txt(i.text)
  const url = txt(i.postUrl) || txt(i.inputUrl)
  const codigo = url?.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/)?.[1]
  const pieza = codigo ? piezasPorUrl.get(codigo) : null
  const id = txt(String(i.id ?? ""))
  if (!texto || !pieza || !id) return null
  return { id: `igc_${id}`, pieza_id: pieza.id, cuenta: pieza.cuenta, usuario: limpiarHandle(i.ownerUsername) || null, texto: texto.slice(0, 2000), likes: num(i.likesCount), fecha: iso(i.timestamp) }
}

// ── Recoger ─────────────────────────────────────────────────────────────────────

// Upsert por lotes. Las filas se agrupan por forma (mismas columnas): un lote con columnas distintas
// no entra, y una columna que no viaja en el lote conserva el valor que ya tenía en la base.
async function guardar(db: DB, tabla: string, filas: Record<string, unknown>[], clave: string) {
  const porForma = new Map<string, Record<string, unknown>[]>()
  for (const f of filas) {
    const forma = Object.keys(f).sort().join(",")
    const l = porForma.get(forma) || []
    l.push(f); porForma.set(forma, l)
  }
  let n = 0
  for (const grupo of porForma.values()) {
    for (let k = 0; k < grupo.length; k += 200) {
      const lote = grupo.slice(k, k + 200)
      const { error } = await db.from(tabla).upsert(lote, { onConflict: clave })
      if (error) throw new Error(`${tabla}: ${error.message}`)
      n += lote.length
    }
  }
  return n
}

async function existentes(db: DB, tabla: string, ids: string[]) {
  const out = new Set<string>()
  for (let k = 0; k < ids.length; k += 300) {
    const { data } = await db.from(tabla).select("id").in("id", ids.slice(k, k + 300))
    for (const f of data || []) out.add(String(f.id))
  }
  return out
}

const unicos = <T extends { id?: string; handle?: string }>(filas: T[]) => [...new Map(filas.map((f) => [f.id || f.handle, f])).values()]

async function procesar(db: DB, corrida: Corrida, items: Item[]) {
  if (corrida.tipo === "piezas") {
    const semillas = new Set((await semillasActivas(db)).map((s) => s.handle))
    const filas = unicos(items.map((i) => piezaDesdeApify(i, semillas)).filter((f): f is NonNullable<typeof f> => f !== null))
    // De las que ya estaban solo se actualizan las métricas. La url de la imagen se vuelve a guardar
    // únicamente si todavía no se pudo bajar (las urls de Instagram vencen y esta es una nueva).
    const ya = new Map<string, { thumb: boolean; slides: boolean }>()
    const ids = filas.map((f) => f.id)
    for (let k = 0; k < ids.length; k += 300) {
      const { data } = await db.from("radar_piezas").select("id,thumb_path,slides").in("id", ids.slice(k, k + 300))
      for (const f of data || []) ya.set(String(f.id), { thumb: Boolean(f.thumb_path), slides: Array.isArray(f.slides) && f.slides.length > 0 })
    }
    const listas = filas.map((f) => {
      const previa = ya.get(f.id)
      const fila: Record<string, unknown> = { ...f }
      if (previa?.thumb) delete fila.thumb_remota
      if (previa?.slides) delete fila.slides_remotas
      return fila
    })
    await guardar(db, "radar_piezas", listas, "id")
    return { items: filas.length, nuevos: filas.filter((f) => !ya.has(f.id)).length }
  }
  if (corrida.tipo === "perfiles") {
    const filas = unicos(items.map(perfilDesdeApify).filter((f): f is NonNullable<typeof f> => f !== null))
    let n = 0
    for (const f of filas) {
      const { handle, ...datos } = f
      const { error, count } = await db.from("radar_semillas").update(datos, { count: "exact" }).eq("handle", handle)
      if (!error && count) n += 1
    }
    return { items: filas.length, nuevos: n }
  }
  if (corrida.tipo === "historias") {
    const filas = unicos(items.map(historiaDesdeApify).filter((f): f is NonNullable<typeof f> => f !== null))
    const ya = await existentes(db, "radar_historias", filas.map((f) => f.id))
    const nuevas = filas.filter((f) => !ya.has(f.id))
    await guardar(db, "radar_historias", nuevas, "id")   // una historia no cambia: las que ya estaban se dejan como están
    // Qué cuentas publicaron algo desde la corrida anterior (lo que responde el segundo chequeo del día).
    const por_cuenta: Record<string, { activas: number; nuevas: number }> = {}
    for (const f of filas) { const c = (por_cuenta[f.cuenta] ||= { activas: 0, nuevas: 0 }); c.activas += 1; if (!ya.has(f.id)) c.nuevas += 1 }
    return { items: filas.length, nuevos: nuevas.length, por_cuenta, sin_leer: items.length - filas.length, muestra: items.length && !filas.length ? Object.keys(items[0]).slice(0, 40) : undefined }
  }
  if (corrida.tipo === "comentarios") {
    const ids = ((corrida.detalle?.piezas as string[]) || [])
    const { data } = await db.from("radar_piezas").select("id,cuenta,url").in("id", ids.length ? ids : ["-"])
    const porCodigo = new Map((data || []).map((p) => [String(p.id).replace(/^ig_/, ""), { id: String(p.id), cuenta: String(p.cuenta) }]))
    const filas = unicos(items.map((i) => comentarioDesdeApify(i, porCodigo)).filter((f): f is NonNullable<typeof f> => f !== null))
    const ya = await existentes(db, "radar_comentarios_crudos", filas.map((f) => f.id))
    await guardar(db, "radar_comentarios_crudos", filas, "id")
    return { items: filas.length, nuevos: filas.filter((f) => !ya.has(f.id)).length }
  }
  return { items: items.length, nuevos: 0 }
}

// Revisa las corridas lanzadas. Devuelve qué pasó con cada una.
export async function recoger(db: DB) {
  const { data, error } = await db.from("radar_corridas").select("*").eq("estado", "lanzada").not("apify_run_id", "is", null).order("iniciado", { ascending: true }).limit(10)
  if (error) throw new Error(error.message)
  const out: Array<Record<string, unknown>> = []
  for (const corrida of (data || []) as Corrida[]) {
    try {
      const run = await leerCorrida(corrida.apify_run_id as string)
      if (run.status === "SUCCEEDED") {
        const items = await leerItems<Item>(run.defaultDatasetId)
        const r = await procesar(db, corrida, items)
        await db.from("radar_corridas").update({ estado: "recogida", items: r.items, nuevos: r.nuevos, costo_usd: run.usageTotalUsd ?? null, terminado: new Date().toISOString(), detalle: { ...(corrida.detalle || {}), ...r, crudos: items.length } }).eq("id", corrida.id)
        out.push({ tipo: corrida.tipo, estado: "recogida", ...r })
      } else if (TERMINADA_MAL.has(run.status)) {
        await db.from("radar_corridas").update({ estado: "error", error: `${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ""}`.slice(0, 500), costo_usd: run.usageTotalUsd ?? null, terminado: new Date().toISOString() }).eq("id", corrida.id)
        out.push({ tipo: corrida.tipo, estado: "error", error: run.status })
      } else if (Date.now() - new Date(corrida.iniciado).getTime() > 3 * 3600e3) {
        await db.from("radar_corridas").update({ estado: "error", error: "sin terminar después de 3 horas", terminado: new Date().toISOString() }).eq("id", corrida.id)
        out.push({ tipo: corrida.tipo, estado: "error", error: "colgada" })
      } else {
        out.push({ tipo: corrida.tipo, estado: "en curso", apify: run.status })
      }
    } catch (e) {
      const mensaje = (e as Error).message
      await db.from("radar_corridas").update({ estado: "error", error: mensaje.slice(0, 500), terminado: new Date().toISOString() }).eq("id", corrida.id)
      out.push({ tipo: corrida.tipo, estado: "error", error: mensaje })
    }
  }
  return out
}
