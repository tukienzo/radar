// Las lecturas que hace Claude en el Radar:
//   analizarPieza      formato, etapa, hook, estructura, CTA, ángulo del banco, objetivo y cómo recrearla;
//                      en reels con voz, además la anatomía del guion; en carruseles, el texto de cada slide.
//   recrearPieza       la versión para la marca propia: reel + carrusel + historias + hooks alternativos.
//   minarComentarios   dolores, objeciones, preguntas, jerga e ideas a partir de los comentarios de la semana.
//   armarDossier       qué hace una cuenta y qué se le puede robar.
//   leerSecuencia      texto en pantalla y tipo de cada historia de una cuenta en un día.
//
// Modelo: claude-opus-5-5 (RADAR_MODELO lo cambia). Salida estructurada contra un esquema, así la respuesta
// siempre se puede guardar. Si el modelo declina un pedido, el servidor lo reintenta con el modelo de
// respaldo que recomienda Anthropic (fallbacks "default").

import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import * as z from "zod/v4"
import { BRAND } from "@/lib/brand"
import { leerBanco, NEGOCIO, textoBanco, type Banco } from "./contexto"
import { DIMENSIONES, ROLES } from "./esquema-guion"
import { baselines, local, rolesDeTramos, semanaISO, urlPublica } from "./metricas"
import { motorTranscripcion } from "./transcribir"
import type { Analisis, Dossier, Guion, Historia, Lectura, MineriaComentarios, Objetivo, Pieza, Recreacion, Semilla, SlidePieza } from "./tipos"

type DB = SupabaseClient
type Bloque = Anthropic.Beta.Messages.BetaTextBlockParam | Anthropic.Beta.Messages.BetaImageBlockParam

export const MODELO = () => process.env.RADAR_MODELO || "claude-opus-5-5"
export const claudeListo = () => Boolean(process.env.ANTHROPIC_API_KEY)

let _cliente: Anthropic | null = null
const cliente = () => (_cliente ||= new Anthropic({ maxRetries: 1, timeout: 150_000 }))

export class Rechazo extends Error {
  constructor(public categoria: string | null) { super(`el modelo declinó el pedido${categoria ? ` (${categoria})` : ""}`) }
}

export type Uso = { entrada: number; salida: number; cache: number; llamadas: number }
export const usoVacio = (): Uso => ({ entrada: 0, salida: 0, cache: 0, llamadas: 0 })

async function pedir<E extends z.ZodType>(esquema: E, sistema: string, contenido: Bloque[], uso: Uso, esfuerzo: "low" | "medium" | "high" = "medium") {
  const r = await cliente().beta.messages.parse({
    model: MODELO(),
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: contenido }],
    output_config: { effort: esfuerzo, format: betaZodOutputFormat(esquema) },
  })
  uso.llamadas += 1
  uso.entrada += r.usage.input_tokens + (r.usage.cache_creation_input_tokens || 0)
  uso.cache += r.usage.cache_read_input_tokens || 0
  uso.salida += r.usage.output_tokens
  if (r.stop_reason === "refusal") throw new Rechazo(r.stop_details?.category ?? null)
  if (r.stop_reason === "max_tokens") throw new Error("la respuesta se cortó por largo")
  if (!r.parsed_output) throw new Error("la respuesta no vino en el formato pedido")
  return { datos: r.parsed_output as z.infer<E>, modelo: r.model }
}

const texto = (t: string): Bloque => ({ type: "text", text: t })
const imagen = (url: string): Bloque => ({ type: "image", source: { type: "url", url } })
const n = (v: number | null | undefined) => (v === null || v === undefined ? "sin dato" : new Intl.NumberFormat("es-AR").format(v))

// ── Esquemas ────────────────────────────────────────────────────────────────────
const FORMATOS = ["talking_head", "carrusel", "screen_recording", "listicle", "entrevista_podcast", "pov_sketch", "caso_cliente", "demo_producto", "texto_pantalla", "vlog", "meme", "otro"] as const
const TIPOS = ["tofu", "problema", "solucion", "producto", "mentalidad"] as const
const NIVELES = ["inconsciente", "consciente_problema", "consciente_solucion", "consciente_producto", "totalmente_consciente"] as const
const OBJETIVOS = ["alcance", "lead_magnet", "gatillo"] as const
const TIPOS_ANGULO = ["curiosidad_revelacion", "dolor_identificacion", "contraste_creencia", "prueba_resultado", "paso_a_paso", "advertencia_error", "historia_personal", "aspiracional", "otro"] as const

const EAnalisis = z.object({
  formato: z.enum(FORMATOS),
  tipo: z.enum(TIPOS),
  nivel_conciencia: z.enum(NIVELES),
  hook_texto: z.string(),
  hook_patron: z.string(),
  estructura: z.array(z.string()),
  cta: z.string(),
  keyword: z.string(),
  recurso_prometido: z.string(),
  por_que_pega: z.string(),
  angulo_numero: z.int(),
  recreable: z.boolean(),
  como_recrear: z.string(),
  temas: z.array(z.string()),
  angulo_comunicacion: z.string(),
  tipo_angulo: z.enum(TIPOS_ANGULO),
  avatar: z.string(),
  promesa: z.string(),
  objetivo: z.enum(OBJETIVOS),
  objetivo_confianza: z.number(),
})

const etiquetas = (d: keyof typeof DIMENSIONES) => z.enum(Object.keys(DIMENSIONES[d].etiquetas) as [string, ...string[]])
const EGuion = z.object({
  topic: etiquetas("topic"), opening: etiquetas("opening"), mechanism: etiquetas("mechanism"), structure: etiquetas("structure"),
  evidence: etiquetas("evidence"), emotion: etiquetas("emotion"), specificity: etiquetas("specificity"), cta: etiquetas("cta"), tema_bm: etiquetas("tema_bm"),
  confianza: z.object({ topic: z.number(), opening: z.number(), mechanism: z.number(), structure: z.number(), evidence: z.number(), emotion: z.number(), specificity: z.number(), cta: z.number(), tema_bm: z.number() }),
  tramos: z.array(z.object({ texto: z.string(), rol: z.enum(Object.keys(ROLES) as [string, ...string[]]) })),
})
const ECarrusel = z.object({
  slides: z.array(z.object({ n: z.int(), texto: z.string(), visual: z.string() })),
  diseno: z.string(), estructura: z.string(), cierre: z.string(),
})
const EPieza = z.object({ analisis: EAnalisis })
const EReel = z.object({ analisis: EAnalisis, guion: EGuion })
const ECarruselCompleto = z.object({ analisis: EAnalisis, carrusel: ECarrusel })

const ERecreacion = z.object({
  reel: z.object({ titulo: z.string(), hook: z.string(), guion: z.array(z.object({ beat: z.string(), texto: z.string(), visual: z.string() })), cta: z.string(), caption: z.string(), duracion_seg: z.int(), formato_sugerido: z.string() }),
  carrusel: z.object({ titulo: z.string(), estilo_sugerido: z.string(), slides: z.array(z.object({ n: z.int(), texto: z.string(), visual: z.string() })), caption: z.string() }),
  historias: z.array(z.object({ n: z.int(), en_pantalla: z.string(), hablado: z.string(), sticker: z.string() })),
  hooks: z.array(z.string()),
  nota_estratega: z.string(),
  violaciones: z.array(z.string()),
})

const EComentarios = z.object({
  dolores: z.array(z.object({ tema: z.string(), n: z.int(), ejemplos: z.array(z.string()) })),
  objeciones: z.array(z.object({ tema: z.string(), n: z.int(), ejemplos: z.array(z.string()) })),
  preguntas: z.array(z.object({ pregunta: z.string(), n: z.int() })),
  jerga: z.array(z.object({ palabra: z.string(), contexto: z.string() })),
  ideas_contenido: z.array(z.string()),
})

const EDossier = z.object({
  veredicto: z.string(),
  secciones: z.array(z.object({ titulo: z.string(), items: z.array(z.string()) })),
  robar: z.array(z.object({ titulo: z.string(), por_que: z.string(), formato: z.string(), hook: z.string(), keyword: z.string(), recurso: z.string(), referencia_id: z.string() })),
})

const TIPOS_HISTORIA = ["hand_raiser", "cta", "why_now", "encuesta", "awareness", "prueba_social", "nutricion", "libre"] as const
const ESecuencia = z.object({
  historias: z.array(z.object({ n: z.int(), texto_en_pantalla: z.string(), tipo: z.enum(TIPOS_HISTORIA), cta: z.boolean(), keyword: z.string() })),
})

// ── Instrucciones ───────────────────────────────────────────────────────────────
const sistema = (banco: Banco, tarea: string) => `${NEGOCIO}\n\n${textoBanco(banco)}\n\n${tarea}`

const TAREA_PIEZA = `TAREA
Sos el analista de contenido de ${BRAND.name}. Recibís una pieza de Instagram de una cuenta que seguimos (con sus métricas, su caption, lo que se dice y sus imágenes) y devolvés su lectura. Trabajás sobre lo que está en la pieza: si algo no se ve o no se dice, el campo va vacío ("") en vez de supuesto.

CAMPOS DE "analisis"
- formato: cómo está producida. talking_head (a cámara), screen_recording (pantalla), listicle (lista de ítems), entrevista_podcast, pov_sketch (actuación o situación), caso_cliente, demo_producto, texto_pantalla (texto sobre video o foto sin voz), vlog, carrusel, meme, otro.
- tipo: etapa de consciencia a la que le habla (tofu, problema, solucion, producto, mentalidad).
- nivel_conciencia: qué tan consciente es el espectador al que le habla.
- hook_texto: el gancho textual, tal como se dice o se lee en los primeros segundos o en la portada.
- hook_patron: el patrón abstracto del gancho, reutilizable en otro nicho, en minúsculas y sin datos del nicho (ej. "X novedades gratis que nadie conoce", "dejá de hacer lo que todos recomiendan").
- estructura: los pasos de la pieza en orden, de 3 a 7, cada uno en pocas palabras.
- cta: el pedido al espectador, textual. keyword: la palabra que pide comentar o mandar, en mayúsculas; "" si no hay. recurso_prometido: lo que entrega a cambio; "" si no hay.
- por_que_pega: el mecanismo que explica el rendimiento, en una o dos oraciones. Si la pieza rindió por debajo de lo normal de la cuenta, decí por qué no pegó.
- angulo_numero: el número del ángulo del banco de ${BRAND.name} que más se le parece; 0 si ninguno.
- recreable: true si ${BRAND.name} podría hacer una versión propia sin romper sus reglas y con sentido para su cliente ideal. como_recrear: cómo sería esa versión, concreta, en una o dos oraciones; "" si no es recreable.
- temas: de 2 a 4 temas cortos. angulo_comunicacion: la idea central en una frase. avatar: a quién le habla. promesa: qué promete.
- objetivo: alcance (busca vistas, compartidos o seguidores; no pide un lead), lead_magnet (pide comentar o escribir una palabra a cambio de un recurso), gatillo (empuja a agendar o comprar: caso, oferta, respuesta a una objeción). objetivo_confianza: de 0 a 1.`

const TAREA_GUION = `

CAMPO "guion" (solo con lo que se DICE en el reel, sin mirar métricas)
Una etiqueta por dimensión, y en "confianza" qué tan seguro estás de cada una (0 a 1). Usá "unclear" si lo hablado no alcanza.
${Object.entries(DIMENSIONES).map(([k, d]) => `- ${k}: ${d.pregunta}. ${Object.entries(d.etiquetas).map(([e, t]) => `${e} = ${t}`).join("; ")}.`).join("\n")}
"tramos": el transcript completo partido en tramos consecutivos (de una a tres oraciones), sin saltear ni reescribir texto, cada uno con su rol:
${Object.entries(ROLES).map(([k, t]) => `- ${k}: ${t}`).join("\n")}`

const TAREA_CARRUSEL = `

CAMPO "carrusel"
- slides: una entrada por imagen, en orden. texto = el texto de la slide transcripto tal cual, con saltos de línea; visual = qué se ve, en una línea.
- diseno: tipografía, colores, recursos gráficos. estructura: cómo avanza de la portada al cierre. cierre: qué pide la última slide.`

const TAREA_RECREAR = `TAREA
Sos el estratega de contenido de ${BRAND.name}. Recibís una pieza ajena que funcionó y su análisis, y escribís la versión de ${BRAND.name} para grabar: mismo mecanismo, otro contenido. No se copia el texto ni el tema ajeno: se traduce el patrón al cliente ideal, a la oferta y a la voz de la marca.
- reel: título de trabajo, hook hablado, guion por beats (cada beat con lo que se dice y lo que se ve), CTA, caption, duración estimada en segundos y formato_sugerido tomado del catálogo de formatos del CRM.
- carrusel: título, estilo sugerido, slides numeradas (texto de la slide y qué se ve) y caption.
- historias: secuencia de 3 a 6 historias que acompañan la pieza (en pantalla, hablado, sticker).
- hooks: 5 ganchos alternativos.
- nota_estratega: por qué esta versión, en qué etapa de consciencia cae y qué ángulo del banco usa.
- violaciones: cada punto del borrador que alguien tiene que revisar antes de publicar porque roza una regla (cifra sin respaldo, caso no confirmado, promesa de resultado, algo que contradiga las reglas que no se negocian). Lista vacía si no hay.
Donde haría falta un número o un caso que no tenés, escribí FALTA en vez de inventarlo.`

const TAREA_COMENTARIOS = `TAREA
Recibís comentarios reales de las piezas que seguimos esta semana. Devolvé lo que dice la audiencia, agrupado:
- dolores y objeciones: tema, cuántos comentarios lo mencionan (n) y hasta 3 ejemplos TEXTUALES.
- preguntas: las que se repiten, con su cantidad.
- jerga: palabras o frases textuales con las que la audiencia nombra su situación, con el contexto en que aparecen.
- ideas_contenido: hasta 12 piezas que responderían a lo anterior, pensadas para el cliente ideal de ${BRAND.name}.
Solo cuenta lo que está en los comentarios. Los ejemplos van copiados tal cual, sin corregir. Ignorá los comentarios que son solo la palabra clave, emojis o spam.`

const TAREA_DOSSIER = `TAREA
Recibís el resumen de los últimos 30 días de una cuenta que seguimos: sus números y sus piezas analizadas. Escribí el dossier:
- veredicto: qué hace esta cuenta y por qué le funciona, en dos oraciones.
- secciones: de 3 a 5, cada una con título e ítems concretos (qué publica y con qué ritmo, qué ganchos repite, cómo capta leads, qué formato le rinde, qué no le funciona). Cada ítem se apoya en un dato del resumen.
- robar: hasta 8 piezas para hacer en ${BRAND.name}, cada una traducida a su cliente ideal: título, por qué, formato, hook, keyword, recurso y referencia_id (el id de la pieza original en la que se basa).`

const TAREA_SECUENCIA = `TAREA
Recibís las historias que publicó una cuenta en un día, en orden. Para cada imagen devolvé:
- texto_en_pantalla: el texto que se lee en la historia, transcripto tal cual; "" si no tiene.
- tipo: hand_raiser (pide levantar la mano: responder o reaccionar), cta (manda a un link, a agendar o a escribir), why_now (urgencia: cupos, fecha, precio), encuesta (encuesta, caja de preguntas o quiz), awareness (instala un problema o una creencia), prueba_social (resultado o testimonio de un cliente), nutricion (enseña algo), libre (vida personal, sin intención de venta).
- cta: true si pide una acción. keyword: la palabra que pide responder, en mayúsculas; "" si no hay.
La entrada n corresponde a la imagen n.`

// ── Lecturas ────────────────────────────────────────────────────────────────────
function fichaPieza(p: Pieza, semilla: Semilla | undefined, medViews: number | null) {
  const outlier = p.views && medViews ? `${(p.views / medViews).toFixed(1)}x la mediana de views de la cuenta` : "sin outlier calculable"
  return [
    `PIEZA ${p.id}`,
    `cuenta: @${p.cuenta}${p.cuenta !== p.cuenta_fuente ? ` (colaboración publicada en @${p.cuenta_fuente})` : ""}${semilla?.seguidores ? ` · ${n(semilla.seguidores)} seguidores` : ""}${semilla?.tags.length ? ` · ${semilla.tags.join(", ")}` : ""}`,
    `tipo: ${p.tipo_media}${p.duracion ? ` · ${Math.round(p.duracion)} s` : ""} · publicada el ${local(p.fecha).dia}`,
    `métricas: ${n(p.views)} views · ${n(p.comentarios)} comentarios · ${n(p.likes)} likes · ${outlier}`,
    `caption:\n${p.caption || "(sin caption)"}`,
    p.transcript ? `lo que se dice (transcripción automática):\n${p.transcript}` : p.tipo_media === "reel" ? "lo que se dice: sin transcripción (reel sin voz o no disponible)" : "",
  ].filter(Boolean).join("\n\n")
}

export async function analizarPieza(p: Pieza, semilla: Semilla | undefined, medViews: number | null, banco: Banco, uso: Uso) {
  const conGuion = p.tipo_media === "reel" && (p.transcript || "").length > 80
  const slides = (p.slides || []).filter((s) => s.path).slice(0, 10)
  const conCarrusel = p.tipo_media === "carrusel" && slides.length > 0
  const contenido: Bloque[] = []
  if (conCarrusel) for (const s of slides) contenido.push(imagen(urlPublica(s.path) as string))
  else if (p.thumb_path) contenido.push(imagen(urlPublica(p.thumb_path) as string))
  contenido.push(texto(fichaPieza(p, semilla, medViews) + (conCarrusel ? `\n\nLas ${slides.length} imágenes son las slides del carrusel, en orden.` : p.thumb_path ? "\n\nLa imagen es la portada de la pieza." : "")))
  const tarea = TAREA_PIEZA + (conGuion ? TAREA_GUION : "") + (conCarrusel ? TAREA_CARRUSEL : "")
  let a: z.infer<typeof EAnalisis>
  let g: z.infer<typeof EGuion> | null = null
  let c: z.infer<typeof ECarrusel> | null = null
  let modelo: string
  if (conGuion) { const r = await pedir(EReel, sistema(banco, tarea), contenido, uso); a = r.datos.analisis; g = r.datos.guion; modelo = r.modelo }
  else if (conCarrusel) { const r = await pedir(ECarruselCompleto, sistema(banco, tarea), contenido, uso); a = r.datos.analisis; c = r.datos.carrusel; modelo = r.modelo }
  else { const r = await pedir(EPieza, sistema(banco, tarea), contenido, uso); a = r.datos.analisis; modelo = r.modelo }
  const angulo = banco.angulos.find((x) => x.numero === a.angulo_numero)
  const { objetivo, objetivo_confianza, ...conAngulo } = a
  const resto: Omit<typeof conAngulo, "angulo_numero"> & { angulo_numero?: number } = { ...conAngulo }
  delete resto.angulo_numero
  const propia = Boolean(semilla?.tags.includes("propia"))
  const analisis: Analisis = {
    ...resto,
    keyword: a.keyword.trim().toUpperCase(),
    angulo_bm_id: angulo?.numero || 0, angulo_bm_nombre: angulo?.titulo || "",
    recreable: propia ? false : a.recreable, como_recrear: propia ? "" : a.como_recrear,
    modelo, con_medios: contenido.length > 1,
  }
  const obj: Objetivo = { objetivo, keyword: analisis.keyword, c: Math.max(0, Math.min(1, objetivo_confianza)) }
  let guion: Guion | null = null
  if (g) {
    const tramos = g.tramos.map((t) => [t.texto, t.rol] as [string, string])
    guion = { topic: g.topic, opening: g.opening, mechanism: g.mechanism, structure: g.structure, evidence: g.evidence, emotion: g.emotion, specificity: g.specificity, cta: g.cta, tema_bm: g.tema_bm, conf: g.confianza, tramos, ro: rolesDeTramos(tramos) }
  }
  let lectura: Lectura | null = null
  let slidesLeidas: SlidePieza[] | null = null
  if (c) {
    const leidas = c.slides
    lectura = { diseno: c.diseno, estructura: c.estructura, cierre: c.cierre }
    slidesLeidas = (p.slides || []).map((s) => { const l = leidas.find((x) => x.n === s.n); return l ? { ...s, texto: l.texto, visual: l.visual } : s })
  }
  return { analisis, objetivo: obj, guion, lectura, slides: slidesLeidas }
}

export async function recrearPieza(p: Pieza, banco: Banco, uso: Uso): Promise<Recreacion> {
  const contenido: Bloque[] = []
  if (p.thumb_path) contenido.push(imagen(urlPublica(p.thumb_path) as string))
  contenido.push(texto([
    fichaPieza(p, undefined, null),
    p.slides?.some((s) => s.texto) ? `slides del carrusel:\n${p.slides.filter((s) => s.texto).map((s) => `${s.n}. ${s.texto}`).join("\n")}` : "",
    p.analisis ? `análisis de la pieza:\n${JSON.stringify(p.analisis, null, 1)}` : "",
  ].filter(Boolean).join("\n\n")))
  const r = await pedir(ERecreacion, sistema(banco, TAREA_RECREAR), contenido, uso, "high")
  return { ...r.datos, generado: new Date().toISOString(), modelo: r.modelo }
}

export async function minarComentarios(comentarios: Array<{ texto: string; cuenta: string }>, banco: Banco, uso: Uso): Promise<MineriaComentarios> {
  const cuerpo = comentarios.map((c, k) => `${k + 1}. [@${c.cuenta}] ${c.texto.replace(/\s+/g, " ")}`).join("\n")
  const r = await pedir(EComentarios, sistema(banco, TAREA_COMENTARIOS), [texto(`COMENTARIOS (${comentarios.length}). Entre corchetes, la cuenta dueña de la pieza.\n\n${cuerpo}`)], uso)
  return r.datos
}

export async function armarDossier(handle: string, resumen: unknown, banco: Banco, uso: Uso): Promise<Dossier> {
  const r = await pedir(EDossier, sistema(banco, TAREA_DOSSIER), [texto(`CUENTA @${handle}\n\n${JSON.stringify(resumen, null, 1)}`)], uso, "high")
  return { cuenta: handle, dias: 30, generado: new Date().toISOString(), ...r.datos, modelo: r.modelo }
}

export async function leerSecuencia(cuenta: string, historias: Historia[], banco: Banco, uso: Uso) {
  const contenido: Bloque[] = historias.map((h) => imagen(urlPublica(h.frame_path) as string))
  contenido.push(texto(`CUENTA @${cuenta} · ${historias.length} historias del ${local(historias[0].fecha).dia}, en orden.\n\n` + historias.map((h, k) =>
    `${k + 1}. ${h.tipo || "historia"}${h.tx ? ` · hablado: ${h.tx}` : ""}${h.stickers?.links?.length ? ` · link: ${h.stickers.links.join(", ")}` : ""}${h.stickers?.encuestas?.length ? ` · encuesta: ${h.stickers.encuestas.join(" / ")}` : ""}${h.stickers?.preguntas?.length ? ` · caja: ${h.stickers.preguntas.join(" / ")}` : ""}`).join("\n")))
  const r = await pedir(ESecuencia, sistema(banco, TAREA_SECUENCIA), contenido, uso, "low")
  return r.datos.historias
}

// ── Pasadas sobre la base ───────────────────────────────────────────────────────
const fatal = (e: unknown) => e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError
const cortar = (e: unknown) => fatal(e) || e instanceof Anthropic.RateLimitError || e instanceof Anthropic.APIConnectionError || (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500)
const motivo = (e: unknown) => (e instanceof Rechazo ? e.message : e instanceof Anthropic.APIError ? `api ${e.status}: ${e.message}` : (e as Error).message).slice(0, 300)

// Analiza las piezas del período que todavía no tienen lectura, de la más comentada a la menos.
// Un reel espera su transcripción y un carrusel sus slides, salvo que ya se sepa que no van a llegar.
export async function analizarPendientes(db: DB, hasta: number, tope = Number(process.env.RADAR_ANALISIS_POR_PASADA || 6)) {
  const out = { analizadas: 0, fallidas: 0, en_espera: 0, corte: null as string | null, uso: usoVacio() }
  if (!claudeListo()) { out.corte = "falta ANTHROPIC_API_KEY"; return out }
  const desde = new Date(Date.now() - 30 * 864e5).toISOString()
  const { data, error } = await db.from("radar_piezas").select("*").is("analisis", null).is("analisis_error", null).gte("fecha", desde)
    .order("comentarios", { ascending: false, nullsFirst: false }).limit(Math.max(80, tope * 8))   // de sobra: muchas todavía esperan su imagen o su voz
  if (error) throw new Error(error.message)
  const candidatas = (data || []) as Pieza[]
  if (!candidatas.length) return out
  const horas = (p: Pieza) => (Date.now() - new Date(p.visto_at).getTime()) / 3600e3
  const hayVoz = Boolean(motorTranscripcion())   // sin motor de transcripción no tiene sentido esperar lo hablado
  const lista = candidatas.filter((p) => {
    const esperaVoz = hayVoz && p.tipo_media === "reel" && p.transcript === null && !p.transcript_error && Boolean(p.video_url) && horas(p) < 12
    const esperaImagen = (Boolean(p.thumb_remota) && !p.thumb_path) || (p.tipo_media === "carrusel" && Boolean(p.slides_remotas) && !p.slides)
    const espera = esperaVoz || (esperaImagen && horas(p) < 6)
    if (espera) out.en_espera += 1
    return !espera
  }).slice(0, tope)
  if (!lista.length) return out
  const [banco, semillas, historia] = await Promise.all([
    leerBanco(db),
    db.from("radar_semillas").select("*").then((r) => (r.data || []) as Semilla[]),
    db.from("radar_piezas").select("id,cuenta_fuente,fecha,views,likes,comentarios,fijado").in("cuenta_fuente", [...new Set(lista.map((p) => p.cuenta_fuente))]).order("fecha", { ascending: false }).limit(2000).then((r) => (r.data || []) as Pieza[]),
  ])
  const base = baselines(historia)
  const porHandle = new Map(semillas.map((s) => [s.handle, s]))
  for (const p of lista) {
    if (Date.now() > hasta) { out.corte = "tiempo"; break }
    try {
      const r = await analizarPieza(p, porHandle.get(p.cuenta_fuente), base.get(p.cuenta_fuente)?.med_views ?? null, banco, out.uso)
      const cambios: Record<string, unknown> = { analisis: r.analisis, objetivo: r.objetivo, analisis_at: new Date().toISOString(), analisis_error: null }
      if (r.guion) cambios.guion = r.guion
      if (r.lectura) cambios.lectura = r.lectura
      if (r.slides) cambios.slides = r.slides
      await db.from("radar_piezas").update(cambios).eq("id", p.id)
      out.analizadas += 1
    } catch (e) {
      out.fallidas += 1
      if (cortar(e)) { out.corte = motivo(e); break }   // sin crédito, sin clave o servicio caído: no tiene sentido seguir
      await db.from("radar_piezas").update({ analisis_error: motivo(e) }).eq("id", p.id)
    }
  }
  return out
}

// Lee las historias que ya tienen el frame bajado, de a una cuenta y un día por llamada.
export async function leerHistoriasPendientes(db: DB, hasta: number, tope = Number(process.env.RADAR_SECUENCIAS_POR_PASADA || 4)) {
  const out = { leidas: 0, secuencias: 0, fallidas: 0, corte: null as string | null, uso: usoVacio() }
  if (!claudeListo()) { out.corte = "falta ANTHROPIC_API_KEY"; return out }
  const { data, error } = await db.from("radar_historias").select("*").is("lectura", null).not("frame_path", "is", null)
    .gte("fecha", new Date(Date.now() - 7 * 864e5).toISOString()).order("fecha", { ascending: true }).limit(200)
  if (error) throw new Error(error.message)
  const grupos = new Map<string, Historia[]>()
  for (const h of (data || []) as Historia[]) {
    // Una historia con video espera su transcripción (si va a llegar) para que la lectura tenga lo hablado.
    if (motorTranscripcion() && h.tipo === "video" && h.tx === null && !h.tx_error && h.video_url && Date.now() - new Date(h.fecha).getTime() < 12 * 3600e3) continue
    const k = `${h.cuenta}|${local(h.fecha).dia}`
    const l = grupos.get(k) || []
    l.push(h); grupos.set(k, l)
  }
  if (!grupos.size) return out
  const banco = await leerBanco(db)
  for (const [k, lista] of [...grupos].slice(0, tope)) {
    if (Date.now() > hasta) { out.corte = "tiempo"; break }
    const tanda = lista.slice(0, 12)
    try {
      const lecturas = await leerSecuencia(k.split("|")[0], tanda, banco, out.uso)
      for (let j = 0; j < tanda.length; j += 1) {
        const l = lecturas.find((x) => x.n === j + 1)
        await db.from("radar_historias").update({ lectura: { tipo: l?.tipo || "libre", texto: l?.texto_en_pantalla || "", cta: Boolean(l?.cta), keyword: (l?.keyword || "").toUpperCase() }, ...(l?.texto_en_pantalla && !tanda[j].caption ? { caption: l.texto_en_pantalla } : {}) }).eq("id", tanda[j].id)
        out.leidas += 1
      }
      out.secuencias += 1
    } catch (e) {
      out.fallidas += 1
      if (cortar(e)) { out.corte = motivo(e); break }
      for (const h of tanda) await db.from("radar_historias").update({ lectura: { tipo: "libre", texto: "", cta: false, keyword: "", error: motivo(e) } }).eq("id", h.id)
    }
  }
  return out
}

// Minería de la semana en curso sobre los comentarios que ya se bajaron.
export async function minarSemana(db: DB) {
  const uso = usoVacio()
  const semana = semanaISO(new Date())
  const { data, error } = await db.from("radar_comentarios_crudos").select("texto,cuenta,likes").gte("created_at", new Date(Date.now() - 8 * 864e5).toISOString()).order("likes", { ascending: false, nullsFirst: false }).limit(3000)
  if (error) throw new Error(error.message)
  // Fuera los comentarios que son solo la keyword, un emoji o una palabra suelta: no dicen nada de la audiencia.
  const utiles = (data || []).filter((c) => String(c.texto).replace(/[^\p{L}\s]/gu, "").trim().split(/\s+/).length >= 4).slice(0, 700)
  if (utiles.length < 20) return { ok: false, motivo: `solo ${utiles.length} comentarios con contenido esta semana`, uso }
  const resultado = await minarComentarios(utiles.map((c) => ({ texto: String(c.texto), cuenta: String(c.cuenta) })), await leerBanco(db), uso)
  const { error: e2 } = await db.from("radar_comentarios").upsert({ semana, n_comentarios: utiles.length, resultado, modelo: MODELO() }, { onConflict: "semana" })
  if (e2) throw new Error(e2.message)
  return { ok: true, semana, comentarios: utiles.length, uso }
}
