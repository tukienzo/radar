// Transcripción de reels e historias con voz. Usa Whisper por API: Groq si hay GROQ_API_KEY (más rápido y
// más barato), si no OpenAI con OPENAI_API_KEY. El video se manda tal cual baja de Instagram.
// La url del video vence en horas: solo se intenta con las que se leyeron hace poco.

import type { SupabaseClient } from "@supabase/supabase-js"

type DB = SupabaseClient
const TOPE_BYTES = 24 * 1024 * 1024
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

export function motorTranscripcion() {
  if (process.env.GROQ_API_KEY) return { nombre: "groq", url: "https://api.groq.com/openai/v1/audio/transcriptions", clave: process.env.GROQ_API_KEY, modelo: process.env.RADAR_MODELO_VOZ || "whisper-large-v3-turbo" }
  if (process.env.OPENAI_API_KEY) return { nombre: "openai", url: "https://api.openai.com/v1/audio/transcriptions", clave: process.env.OPENAI_API_KEY, modelo: process.env.RADAR_MODELO_VOZ || "whisper-1" }
  return null
}

export async function transcribirUrl(videoUrl: string) {
  const motor = motorTranscripcion()
  if (!motor) throw new Error("sin motor de transcripción: falta GROQ_API_KEY u OPENAI_API_KEY")
  const v = await fetch(videoUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) })
  if (!v.ok) throw new Error(`video http ${v.status}`)
  const peso = Number(v.headers.get("content-length") || 0)
  if (peso > TOPE_BYTES) throw new Error(`video de ${Math.round(peso / 1048576)} MB: supera el tope de 24 MB`)
  const datos = await v.arrayBuffer()
  if (datos.byteLength > TOPE_BYTES) throw new Error(`video de ${Math.round(datos.byteLength / 1048576)} MB: supera el tope de 24 MB`)
  const form = new FormData()
  form.append("file", new Blob([datos], { type: "video/mp4" }), "video.mp4")
  form.append("model", motor.modelo)
  form.append("response_format", "json")
  form.append("temperature", "0")
  const r = await fetch(motor.url, { method: "POST", headers: { Authorization: `Bearer ${motor.clave}` }, body: form, signal: AbortSignal.timeout(120000) })
  if (!r.ok) throw new Error(`${motor.nombre} ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = (await r.json()) as { text?: string }
  return (j.text || "").trim()
}

const vencida = (e: unknown) => /video http (403|404|410)/.test((e as Error).message || "")
// Un texto muy corto suele ser música o ruido que Whisper "completa": se guarda vacío para no analizar basura.
// También se descarta lo que no está en alfabeto latino: suele ser la letra de una canción mal reconocida.
const limpio = (t: string) => {
  const x = t.replace(/\s+/g, " ").trim()
  if (x.length < 12) return ""
  const letras = x.replace(/[^\p{L}]/gu, "")
  const latinas = letras.replace(/[^\p{Script=Latin}]/gu, "")
  return letras.length && latinas.length / letras.length < 0.8 ? "" : x
}

export async function transcribirPendientes(db: DB, hasta: number, tope = Number(process.env.RADAR_TRANSCRIPCIONES_POR_PASADA || 4)) {
  const out = { reels: 0, historias: 0, fallidas: 0, motor: motorTranscripcion()?.nombre || null }
  if (!out.motor) return out
  const fresca = new Date(Date.now() - 20 * 3600e3).toISOString()

  const { data: piezas } = await db.from("radar_piezas").select("id,video_url,duracion")
    .eq("tipo_media", "reel").is("transcript", null).is("transcript_error", null).not("video_url", "is", null).gte("video_url_at", fresca)
    .order("comentarios", { ascending: false, nullsFirst: false }).limit(tope)
  for (const p of piezas || []) {
    if (Date.now() > hasta) return out
    try {
      const texto = limpio(await transcribirUrl(String(p.video_url)))
      await db.from("radar_piezas").update({ transcript: texto, transcript_error: texto ? null : "sin voz" }).eq("id", p.id)
      out.reels += 1
    } catch (e) {
      out.fallidas += 1
      // Url vencida: se deja sin error para que se reintente cuando la próxima corrida traiga una nueva.
      if (vencida(e)) await db.from("radar_piezas").update({ video_url: null, video_url_at: null }).eq("id", p.id)
      else await db.from("radar_piezas").update({ transcript_error: (e as Error).message.slice(0, 300) }).eq("id", p.id)
    }
  }

  const { data: historias } = await db.from("radar_historias").select("id,video_url,stickers")
    .eq("tipo", "video").is("tx", null).is("tx_error", null).not("video_url", "is", null).gte("video_url_at", fresca)
    .order("fecha", { ascending: false }).limit(tope)
  for (const h of historias || []) {
    if (Date.now() > hasta) return out
    // Historia con canción de fondo: lo que se escucha es la música, no alguien hablando.
    if ((h.stickers as { musica?: boolean } | null)?.musica) { await db.from("radar_historias").update({ tx: "", tx_error: "música de fondo" }).eq("id", h.id); continue }
    try {
      const texto = limpio(await transcribirUrl(String(h.video_url)))
      await db.from("radar_historias").update({ tx: texto, tx_error: texto ? null : "sin voz" }).eq("id", h.id)
      out.historias += 1
    } catch (e) {
      out.fallidas += 1
      if (vencida(e)) await db.from("radar_historias").update({ video_url: null, video_url_at: null }).eq("id", h.id)
      else await db.from("radar_historias").update({ tx_error: (e as Error).message.slice(0, 300) }).eq("id", h.id)
    }
  }
  return out
}
