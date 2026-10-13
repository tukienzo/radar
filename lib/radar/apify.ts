// Cliente mínimo de Apify: lanzar un actor, mirar cómo va la corrida y leer lo que dejó.
// Las corridas se lanzan sin esperar (tardan minutos) y se recogen en un paso aparte (lib/radar/ciclo.ts).
//
// Variables: APIFY_TOKEN (obligatoria) · RADAR_TOPE_USD (tope de gasto por corrida, default 3).
// Los actores se pueden cambiar sin tocar código: RADAR_ACTOR_PIEZAS, RADAR_ACTOR_PERFILES,
// RADAR_ACTOR_HISTORIAS, RADAR_ACTOR_COMENTARIOS (formato "usuario~actor").

const BASE = "https://api.apify.com/v2"

export const ACTORES = {
  piezas: () => process.env.RADAR_ACTOR_PIEZAS || "apify~instagram-scraper",
  perfiles: () => process.env.RADAR_ACTOR_PERFILES || "apify~instagram-profile-scraper",
  historias: () => process.env.RADAR_ACTOR_HISTORIAS || "datavoyantlab~advanced-instagram-stories-scraper",
  comentarios: () => process.env.RADAR_ACTOR_COMENTARIOS || "apify~instagram-comment-scraper",
}

export const apifyToken = () => (process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || "").trim()
export const apifyListo = () => Boolean(apifyToken())

export class ApifyError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

async function pedir<T>(path: string, init?: RequestInit): Promise<T> {
  const token = apifyToken()
  if (!token) throw new ApifyError("Falta APIFY_TOKEN: el Radar no puede leer Instagram hasta que se conecte Apify", 412)
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  })
  if (!r.ok) {
    const cuerpo = await r.text().catch(() => "")
    let mensaje = cuerpo.slice(0, 300)
    try { mensaje = JSON.parse(cuerpo)?.error?.message || mensaje } catch { /* no era JSON */ }
    throw new ApifyError(`Apify ${r.status}: ${mensaje}`, r.status)
  }
  return (await r.json()) as T
}

export type CorridaApify = {
  id: string
  status: "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMING-OUT" | "TIMED-OUT" | "ABORTING" | "ABORTED"
  defaultDatasetId: string
  usageTotalUsd?: number
  statusMessage?: string
  startedAt?: string
  finishedAt?: string | null
}

export async function lanzarActor(actor: string, input: unknown, o: { segundos?: number; memoriaMb?: number } = {}) {
  const tope = Number(process.env.RADAR_TOPE_USD || 3)
  const q = new URLSearchParams({ timeout: String(o.segundos || 1800) })
  if (o.memoriaMb) q.set("memory", String(o.memoriaMb))
  if (tope > 0) q.set("maxTotalChargeUsd", String(tope))
  const r = await pedir<{ data: CorridaApify }>(`/acts/${encodeURIComponent(actor)}/runs?${q}`, { method: "POST", body: JSON.stringify(input) })
  return r.data
}

// Corre un actor y espera los items (solo para lecturas chicas, como un perfil: Apify corta a los `segundos`).
export async function correrActorSync<T = Record<string, unknown>>(actor: string, input: unknown, segundos = 120) {
  const q = new URLSearchParams({ timeout: String(segundos), clean: "true", format: "json" })
  const tope = Number(process.env.RADAR_TOPE_USD || 3)
  if (tope > 0) q.set("maxTotalChargeUsd", String(tope))
  return pedir<T[]>(`/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?${q}`, { method: "POST", body: JSON.stringify(input) })
}

export async function leerCorrida(runId: string) {
  return (await pedir<{ data: CorridaApify }>(`/actor-runs/${encodeURIComponent(runId)}`)).data
}

// Todos los items del dataset, de a páginas. `tope` evita que una corrida descontrolada llene la memoria.
export async function leerItems<T = Record<string, unknown>>(datasetId: string, tope = 5000) {
  const out: T[] = []
  const pagina = 500
  for (let offset = 0; offset < tope; offset += pagina) {
    const lote = await pedir<T[]>(`/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&offset=${offset}&limit=${pagina}`)
    out.push(...lote)
    if (lote.length < pagina) break
  }
  return out
}

// Cuánto se gastó del tope mensual de la cuenta de Apify. Se mira antes de lanzar: con el tope casi
// consumido no se lanza nada más, para que el mes no se quede sin historias por haber leído piezas de más.
export async function presupuesto() {
  try {
    const l = await pedir<{ data: { limits?: { maxMonthlyUsageUsd?: number }; current?: { monthlyUsageUsd?: number }; monthlyUsageCycle?: { endAt?: string } } }>("/users/me/limits")
    const tope = Number(l.data.limits?.maxMonthlyUsageUsd) || 0
    const usado = Number(l.data.current?.monthlyUsageUsd) || 0
    return { tope, usado: Math.round(usado * 100) / 100, libre: Math.max(0, Math.round((tope - usado) * 100) / 100), renueva: l.data.monthlyUsageCycle?.endAt || null, agotado: tope > 0 && usado >= tope * 0.97 }
  } catch {
    return null
  }
}

// Cuánto lee el cron (lo que se pide a mano desde la página corre siempre):
//   "estandar" (default, pensado para un plan pago chico de Apify): historias dos veces por día (los
//              horarios están en vercel.json), piezas lunes, miércoles y viernes, comentarios una vez por
//              semana. El gasto depende de cuántas cuentas sigas: miralo en Radar → Semillas.
//   "completo" todo a diario.   "gratis" piezas lunes y jueves, sin historias (el plan gratuito no las permite).
export type PlanRadar = "gratis" | "estandar" | "completo"
export const planRadar = (): PlanRadar => {
  const p = String(process.env.RADAR_PLAN || "estandar").toLowerCase()
  return p === "completo" || p === "gratis" ? p : "estandar"
}

export const TERMINADA_MAL = new Set(["FAILED", "TIMED-OUT", "ABORTED"])
