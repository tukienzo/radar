// Baja al bucket "radar" las imágenes que quedaron pendientes (miniaturas, slides de carruseles, frames de
// historias y fotos de perfil), ya reducidas. Las urls de Instagram vencen, así que esto corre seguido y
// con presupuesto de tiempo: lo que no entra en una pasada queda para la siguiente.

import type { SupabaseClient } from "@supabase/supabase-js"

type DB = SupabaseClient
const BUCKET = "radar"
const ANCHO = 540
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

// sharp se carga recién cuando hace falta y una sola vez. Si el servidor no lo tiene disponible, las
// imágenes se guardan como llegan (pesan más, pero el Radar sigue andando en vez de caerse entero).
type Reductor = (typeof import("sharp"))["default"]
let reductor: Promise<Reductor | null> | null = null
const cargarReductor = () => (reductor ||= import("sharp").then((m) => m.default).catch((e) => { console.error("radar: sharp no disponible, las imágenes se guardan sin reducir ·", (e as Error).message.slice(0, 200)); return null }))
export const hayReductor = async () => Boolean(await cargarReductor())

type Imagen = { datos: Buffer; tipo: string }

async function bajar(url: string, ancho = ANCHO): Promise<Imagen> {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/jpeg,image/png,image/*;q=0.8" }, signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(`http ${r.status}`)
  const crudo = Buffer.from(await r.arrayBuffer())
  if (crudo.length < 500) throw new Error("imagen vacía")
  const sharp = await cargarReductor()
  if (sharp) return { datos: await sharp(crudo).rotate().resize({ width: ancho, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer(), tipo: "image/jpeg" }
  const tipo = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim()
  if (!["image/jpeg", "image/png", "image/webp"].includes(tipo)) throw new Error(`unsupported image ${tipo}`)
  if (crudo.length > 2 * 1024 * 1024) throw new Error("imagen de más de 2 MB y sin reductor")
  return { datos: crudo, tipo }
}

async function subir(db: DB, path: string, imagen: Imagen) {
  const { error } = await db.storage.from(BUCKET).upload(path, imagen.datos, { contentType: imagen.tipo, cacheControl: "31536000", upsert: true })
  if (error) throw new Error(error.message)
  return path
}

// Una url vencida o bloqueada no se reintenta: se borra para que la próxima corrida traiga una nueva.
const definitivo = (e: unknown) => /http (403|404|410)|imagen vacía|unsupported image|Input buffer|sin reductor/i.test((e as Error).message || "")

export async function descargarMedios(db: DB, hasta: number) {
  const out = { miniaturas: 0, slides: 0, frames: 0, perfiles: 0, fallidas: 0, reducidas: await hayReductor() }
  const queda = () => Date.now() < hasta

  const { data: piezas } = await db.from("radar_piezas").select("id,thumb_remota").is("thumb_path", null).not("thumb_remota", "is", null).order("fecha", { ascending: false }).limit(80)
  for (const p of piezas || []) {
    if (!queda()) return out
    try {
      const path = await subir(db, `piezas/${p.id}.jpg`, await bajar(String(p.thumb_remota)))
      await db.from("radar_piezas").update({ thumb_path: path, thumb_remota: null }).eq("id", p.id)
      out.miniaturas += 1
    } catch (e) {
      out.fallidas += 1
      if (definitivo(e)) await db.from("radar_piezas").update({ thumb_remota: null }).eq("id", p.id)
    }
  }

  const { data: historias } = await db.from("radar_historias").select("id,frame_remota").is("frame_path", null).not("frame_remota", "is", null).order("fecha", { ascending: false }).limit(80)
  for (const h of historias || []) {
    if (!queda()) return out
    try {
      const path = await subir(db, `historias/${h.id}.jpg`, await bajar(String(h.frame_remota), 720))
      await db.from("radar_historias").update({ frame_path: path, frame_remota: null }).eq("id", h.id)
      out.frames += 1
    } catch (e) {
      out.fallidas += 1
      if (definitivo(e)) await db.from("radar_historias").update({ frame_remota: null }).eq("id", h.id)
    }
  }

  const { data: carruseles } = await db.from("radar_piezas").select("id,slides_remotas").is("slides", null).not("slides_remotas", "is", null).order("comentarios", { ascending: false, nullsFirst: false }).limit(25)
  for (const p of carruseles || []) {
    if (!queda()) return out
    const urls = (Array.isArray(p.slides_remotas) ? p.slides_remotas : []) as string[]
    const slides: Array<{ n: number; path: string }> = []
    let vencida = false
    for (let k = 0; k < urls.length && queda(); k += 1) {
      try {
        slides.push({ n: k + 1, path: await subir(db, `slides/${p.id}/${k + 1}.jpg`, await bajar(urls[k])) })
        out.slides += 1
      } catch (e) {
        out.fallidas += 1
        if (definitivo(e)) vencida = true
      }
    }
    // Se cierra el carrusel solo si se recorrieron todas las slides (o vencieron): si se cortó por tiempo, sigue pendiente.
    if (slides.length === urls.length || vencida) await db.from("radar_piezas").update({ slides: slides.length ? slides : null, slides_remotas: null }).eq("id", p.id)
  }

  const { data: perfiles } = await db.from("radar_semillas").select("handle,foto_remota").not("foto_remota", "is", null).limit(40)
  for (const s of perfiles || []) {
    if (!queda()) return out
    try {
      const path = await subir(db, `perfiles/${s.handle}.jpg`, await bajar(String(s.foto_remota), 240))
      await db.from("radar_semillas").update({ foto_path: path, foto_remota: null }).eq("handle", s.handle)
      out.perfiles += 1
    } catch (e) {
      out.fallidas += 1
      if (definitivo(e)) await db.from("radar_semillas").update({ foto_remota: null }).eq("handle", s.handle)
    }
  }
  return out
}

// Limpieza: las imágenes de piezas viejas que no fueron bangers ni se recrearon se borran para no llenar el bucket.
export async function podarMedios(db: DB, dias = Number(process.env.RADAR_DIAS_MEDIOS || 120)) {
  const corte = new Date(Date.now() - dias * 864e5).toISOString()
  const { data } = await db.from("radar_piezas").select("id,thumb_path,slides").lt("fecha", corte).is("recreacion", null).not("slides", "is", null).limit(200)
  let borradas = 0
  for (const p of data || []) {
    const paths = ((p.slides || []) as Array<{ path: string }>).map((s) => s.path).filter(Boolean)
    if (!paths.length) continue
    const { error } = await db.storage.from(BUCKET).remove(paths)
    if (!error) { await db.from("radar_piezas").update({ slides: null }).eq("id", p.id); borradas += paths.length }
  }
  const { data: hs } = await db.from("radar_historias").select("id,frame_path").lt("fecha", corte).not("frame_path", "is", null).is("metricas", null).limit(300)
  for (const h of hs || []) {
    const { error } = await db.storage.from(BUCKET).remove([String(h.frame_path)])
    if (!error) { await db.from("radar_historias").update({ frame_path: null }).eq("id", h.id); borradas += 1 }
  }
  return { borradas }
}
