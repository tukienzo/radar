// Cuentas del Radar. Todo acá es puro (sin base ni red): recibe filas y devuelve lo que muestra la página.
//
//   outlier   = views de la pieza / mediana de views de su cuenta (últimas 30 piezas, mínimo 5 con views)
//   tasa_com  = comentarios / views
//   velocidad = comentarios / días desde que se publicó
//   eng_x_seg = (likes + comentarios) / seguidores de la cuenta
//   score     = 0 a 100: 50 % comentarios, 30 % outlier, 20 % tasa, cada uno como percentil dentro del período.
//               Si la pieza no tiene views (carruseles, posts) el outlier se toma sobre comentarios y el peso
//               de la tasa se reparte entre los otros dos, para no castigar al formato.

import type { Guion, Historia, MineriaComentarios, Pieza, PiezaVista, Semilla } from "./tipos"

export const ZONA = "America/Argentina/Buenos_Aires"
export const VENTANA_DIAS = 30
export const BASELINE_N = 30
export const BASELINE_MIN = 5
export const BANGER = 3
const DIA = 864e5

export function mediana(valores: Array<number | null | undefined>): number | null {
  const s = valores.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b)
  if (!s.length) return null
  const m = (s.length - 1) / 2
  return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2
}

const red = (v: number | null, d = 2) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d)

// Partes de la fecha en hora de Argentina (la base guarda UTC).
export function local(fecha: Date | string) {
  const d = typeof fecha === "string" ? new Date(fecha) : fecha
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  )
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hora: Number(p.hour), dia: `${p.year}-${p.month}-${p.day}`, dow: p.weekday }
}

export function semanaISO(fecha: Date | string) {
  const { y, m, d } = local(fecha)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const inicio = Date.UTC(t.getUTCFullYear(), 0, 1)
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - inicio) / DIA + 1) / 7)).padStart(2, "0")}`
}

export function urlPublica(path: string | null | undefined) {
  if (!path) return null
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "")
  return `${base}/storage/v1/object/public/radar/${path.split("/").map(encodeURIComponent).join("/")}`
}

export type Baseline = { med_views: number | null; med_likes: number | null; med_com: number | null; n: number; n_views: number }

// Mediana por cuenta sobre sus últimas 30 piezas. Las fijadas quedan afuera: están fijadas justamente
// porque fueron las que más rindieron y correrían la vara hacia arriba.
export function baselines(piezas: Pieza[]) {
  const porCuenta = new Map<string, Pieza[]>()
  for (const p of piezas) {
    if (p.fijado) continue
    const l = porCuenta.get(p.cuenta_fuente) || []
    l.push(p); porCuenta.set(p.cuenta_fuente, l)
  }
  const out = new Map<string, Baseline>()
  for (const [cuenta, lista] of porCuenta) {
    const ult = lista.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, BASELINE_N)
    const conViews = ult.filter((p) => (p.views ?? 0) > 0)
    out.set(cuenta, {
      med_views: conViews.length >= BASELINE_MIN ? mediana(conViews.map((p) => p.views)) : null,
      med_likes: mediana(ult.map((p) => p.likes)),
      med_com: ult.length >= BASELINE_MIN ? mediana(ult.map((p) => p.comentarios)) : null,
      n: ult.length,
      n_views: conViews.length,
    })
  }
  return out
}

function percentil(orden: number[], v: number | null) {
  if (v === null || !orden.length) return null
  let lo = 0, hi = orden.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (orden[mid] <= v) lo = mid + 1; else hi = mid }
  return lo / orden.length
}

// Las piezas del período con sus métricas derivadas, sin los campos pesados.
export function vistas(piezas: Pieza[], semillas: Semilla[], ahora: Date, dias = VENTANA_DIAS): PiezaVista[] {
  const base = baselines(piezas)
  const seguidores = new Map(semillas.map((s) => [s.handle, s.seguidores]))
  const corte = new Date(ahora.getTime() - dias * DIA).toISOString()
  const crudas = piezas.filter((p) => p.fecha >= corte).map((p) => {
    const b = base.get(p.cuenta_fuente)
    const com = p.comentarios ?? 0
    const views = (p.views ?? 0) > 0 ? (p.views as number) : null
    const d = Math.max(0.1, (ahora.getTime() - new Date(p.fecha).getTime()) / DIA)
    const seg = seguidores.get(p.cuenta_fuente) || seguidores.get(p.cuenta) || null
    return {
      p, com, views, d,
      tasa: views ? com / views : null,
      outlier: views && b?.med_views ? views / b.med_views : null,
      outlierCom: b?.med_com ? com / b.med_com : null,
      eng: seg ? ((p.likes ?? 0) + com) / seg : null,
    }
  })
  const orden = (f: (x: (typeof crudas)[number]) => number | null) => crudas.map(f).filter((v): v is number => v !== null).sort((a, b) => a - b)
  const oCom = orden((x) => x.com), oOut = orden((x) => x.outlier), oOutCom = orden((x) => x.outlierCom), oTasa = orden((x) => x.tasa)
  return crudas.map(({ p, com, views, d, tasa, outlier, outlierCom, eng }) => {
    const partes: Array<[number, number | null]> = [
      [0.5, percentil(oCom, com)],
      [0.3, outlier !== null ? percentil(oOut, outlier) : percentil(oOutCom, outlierCom)],
      [0.2, percentil(oTasa, tasa)],
    ]
    const validas = partes.filter(([, v]) => v !== null) as Array<[number, number]>
    const peso = validas.reduce((s, [w]) => s + w, 0)
    const score = peso ? Math.round((validas.reduce((s, [w, v]) => s + w * v, 0) / peso) * 100) : 0
    return {
      id: p.id, plataforma: p.plataforma, cuenta: p.cuenta, cuenta_fuente: p.cuenta_fuente, url: p.url, tipo_media: p.tipo_media,
      fecha: p.fecha, semana: semanaISO(p.fecha), caption: p.caption || "", likes: p.likes, comentarios: p.comentarios, views,
      duracion: p.duracion, tasa_com: red(tasa, 4), outlier: red(outlier), outlier_com: red(outlierCom), eng_x_seg: red(eng, 4),
      dias: red(d, 1) as number, velocidad: red(com / d, 1), score, fijado: p.fijado,
      analisis: p.analisis, objetivo: p.objetivo, recreacion: Boolean(p.recreacion),
      thumb_local: urlPublica(p.thumb_path), n_slides: p.slides?.length || 0, con_transcript: Boolean(p.transcript),
    }
  })
}

const normalizar = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim()

export function tendencias(semana: PiezaVista[]) {
  const formatos: Record<string, number> = {}
  const hooks = new Map<string, { texto: string; cuentas: Set<string> }>()
  for (const p of semana) {
    const a = p.analisis
    if (!a) continue
    if (a.formato) formatos[a.formato] = (formatos[a.formato] || 0) + 1
    const k = normalizar(a.hook_patron || "")
    if (k.length < 6) continue
    const h = hooks.get(k) || { texto: a.hook_patron, cuentas: new Set<string>() }
    h.cuentas.add(p.cuenta); hooks.set(k, h)
  }
  return {
    formatos: Object.fromEntries(Object.entries(formatos).sort((a, b) => b[1] - a[1])),
    hooks_repetidos: Object.fromEntries([...hooks.values()].filter((h) => h.cuentas.size >= 2).sort((a, b) => b.cuentas.size - a.cuentas.size).map((h) => [h.texto, [...h.cuentas]])),
  }
}

export type DatosRadar = ReturnType<typeof construirDatos>

export function construirDatos(o: {
  piezas: Pieza[]; semillas: Semilla[]; comentarios: (MineriaComentarios & { n_comentarios: number; semana: string }) | null
  corte: string | null; fuentes: { piezas: string; comentarios: string; analisis: string }; ahora: Date
}) {
  const semana = semanaISO(o.ahora)
  const ps = vistas(o.piezas, o.semillas, o.ahora)
  const base = baselines(o.piezas)
  const propias = new Set(o.semillas.filter((s) => s.tags.includes("propia")).map((s) => s.handle))
  const deLaSemana = ps.filter((p) => p.semana === semana && !propias.has(p.cuenta) && !propias.has(p.cuenta_fuente))
  const cuentasSemana = new Set(deLaSemana.map((p) => p.cuenta))
  const semillas = o.semillas.map((s) => {
    const suyas = ps.filter((p) => p.cuenta_fuente === s.handle && p.semana === semana)
    const b = base.get(s.handle)
    return {
      handle: s.handle, tags: s.tags, activa: s.activa, historias: s.historias, nota: s.nota || "", nombre: s.nombre, seguidores: s.seguidores,
      foto: urlPublica(s.foto_path),
      piezas_semana: suyas.length,
      comentarios_semana: suyas.reduce((t, p) => t + (p.comentarios || 0), 0),
      bangers: suyas.filter((p) => (p.outlier ?? 0) >= BANGER).length,
      med_views: b?.med_views ?? null, med_likes: b?.med_likes ?? null, n_baseline: b?.n ?? 0,
    }
  }).sort((a, b) => Number(b.activa) - Number(a.activa) || (b.seguidores ?? 0) - (a.seguidores ?? 0))
  return {
    generado: o.ahora.toISOString(),
    semana,
    demo: false,
    kpis: {
      piezas: deLaSemana.length,
      cuentas: cuentasSemana.size,
      bangers: deLaSemana.filter((p) => (p.outlier ?? 0) >= BANGER).length,
      comentarios: deLaSemana.reduce((t, p) => t + (p.comentarios || 0), 0),
      analizadas: deLaSemana.filter((p) => p.analisis).length,
      recreables: deLaSemana.filter((p) => p.analisis?.recreable).length,
      recreadas: deLaSemana.filter((p) => p.recreacion).length,
      con_views: deLaSemana.filter((p) => p.views).length,
      cuentas_con_baseline: [...cuentasSemana].filter((c) => base.get(c)?.med_views).length,
    },
    piezas: ps.sort((a, b) => (b.comentarios ?? 0) - (a.comentarios ?? 0)),
    ventana_dias: VENTANA_DIAS,
    tendencias: tendencias(deLaSemana),
    semillas,
    comentarios: o.comentarios,
    fuentes: { ...o.fuentes, corte: o.corte || "sin corridas todavía" },
  }
}

// ── Cuenta a fondo ──────────────────────────────────────────────────────────────
const DIAS_SEMANA: Record<string, string> = { Mon: "lun", Tue: "mar", Wed: "mié", Thu: "jue", Fri: "vie", Sat: "sáb", Sun: "dom" }

export function vistaCuenta(semilla: Semilla, historia: Pieza[], ahora: Date, dias = VENTANA_DIAS) {
  const corte = new Date(ahora.getTime() - dias * DIA).toISOString()
  const medComHist = mediana(historia.map((p) => p.comentarios))
  const ventana = historia.filter((p) => p.fecha >= corte)
  const reels = ventana.filter((p) => p.tipo_media === "reel")
  const porClave = <T,>(items: T[], clave: (x: T) => string | null | undefined) => {
    const g = new Map<string, T[]>()
    for (const x of items) { const k = clave(x); if (!k) continue; const l = g.get(k) || []; l.push(x); g.set(k, l) }
    return g
  }
  const formatos = Object.fromEntries([...porClave(ventana, (p) => p.tipo_media)].map(([k, l]) => [k, {
    n: l.length, med_com: mediana(l.map((p) => p.comentarios)), med_likes: mediana(l.map((p) => p.likes)), med_views: mediana(l.map((p) => ((p.views ?? 0) > 0 ? p.views : null))),
  }]))
  const cuenta = (items: Pieza[], clave: (p: Pieza) => string | null | undefined) =>
    Object.fromEntries([...porClave(items, clave)].map(([k, l]) => [k, l.length] as [string, number]).sort((a, b) => b[1] - a[1]))
  const keywords = [...porClave(ventana, (p) => (p.analisis?.keyword || p.objetivo?.keyword || "").trim().toUpperCase() || null)]
    .map(([keyword, l]) => ({
      keyword, n: l.length, com_total: l.reduce((t, p) => t + (p.comentarios || 0), 0), med_com: mediana(l.map((p) => p.comentarios)),
      recurso: l.map((p) => p.analisis?.recurso_prometido).find(Boolean) || "",
    })).sort((a, b) => b.com_total - a.com_total)
  const hooks = [...porClave(ventana, (p) => normalizar(p.analisis?.hook_patron || "") || null)]
    .map(([, l]) => ({ patron: l[0].analisis?.hook_patron || "", n: l.length, med_com: mediana(l.map((p) => p.comentarios)) }))
    .sort((a, b) => b.n - a.n || (b.med_com ?? 0) - (a.med_com ?? 0))
  const horas: Record<string, number> = {}; const diasSemana: Record<string, number> = { lun: 0, mar: 0, mié: 0, jue: 0, vie: 0, sáb: 0, dom: 0 }
  const serie = new Map<string, { n: number; com: number }>()
  for (const p of ventana) {
    const l = local(p.fecha)
    horas[l.hora] = (horas[l.hora] || 0) + 1
    diasSemana[DIAS_SEMANA[l.dow] || l.dow] = (diasSemana[DIAS_SEMANA[l.dow] || l.dow] || 0) + 1
    const s = serie.get(l.dia) || { n: 0, com: 0 }
    s.n += 1; s.com += p.comentarios || 0; serie.set(l.dia, s)
  }
  const fechas = ventana.map((p) => p.fecha).sort()
  const span = fechas.length ? Math.max(1, Math.round((new Date(fechas[fechas.length - 1]).getTime() - new Date(fechas[0]).getTime()) / DIA) + 1) : 0
  return {
    handle: semilla.handle,
    dias,
    generado: ahora.toISOString(),
    perfil: { seguidores: semilla.seguidores, posts: semilla.posts, nombre: semilla.nombre, bio: semilla.bio, actualizado: semilla.perfil_at?.slice(0, 10) || null, foto: urlPublica(semilla.foto_path) },
    historico: { n: historia.length, desde: historia.length ? local(historia.map((p) => p.fecha).sort()[0]).dia : null, med_com: medComHist },
    agregados: {
      n: ventana.length, fijados: ventana.filter((p) => p.fijado).length, dias: span, por_dia: span ? red(ventana.length / span) : null,
      com_total: ventana.reduce((t, p) => t + (p.comentarios || 0), 0), med_com: mediana(ventana.map((p) => p.comentarios)), med_likes: mediana(ventana.map((p) => p.likes)),
      med_views_reel: mediana(reels.map((p) => ((p.views ?? 0) > 0 ? p.views : null))), dur_med_reel: red(mediana(reels.map((p) => p.duracion)), 1),
      slides_med: mediana(ventana.filter((p) => p.tipo_media === "carrusel").map((p) => p.slides?.length || p.slides_remotas?.length || null)),
      formatos, tipos: cuenta(ventana, (p) => p.analisis?.tipo), formatos_analisis: cuenta(ventana, (p) => p.analisis?.formato),
      keywords, hooks, horas, dias_semana: diasSemana,
      serie: [...serie].sort((a, b) => a[0].localeCompare(b[0])).map(([fecha, v]) => ({ fecha, ...v })),
      con_transcript: ventana.filter((p) => p.transcript).length, con_slides: ventana.filter((p) => p.slides?.some((s) => s.texto)).length,
      analizadas: ventana.filter((p) => p.analisis).length,
    },
    piezas: ventana.map((p) => ({
      id: p.id, cuenta: p.cuenta, cuenta_fuente: p.cuenta_fuente, url: p.url, tipo_media: p.tipo_media, fecha: p.fecha, caption: p.caption || "",
      likes: p.likes, comentarios: p.comentarios, views: (p.views ?? 0) > 0 ? p.views : null, duracion: p.duracion, fijado: p.fijado,
      outlier_com: medComHist ? red((p.comentarios ?? 0) / medComHist) : null,
      analisis: p.analisis, objetivo: p.objetivo, recreacion: Boolean(p.recreacion),
      thumb_local: urlPublica(p.thumb_path), n_slides: p.slides?.length || 0, con_transcript: Boolean(p.transcript), slides_leidas: Boolean(p.slides?.some((s) => s.texto)),
    })),
    dossier: semilla.dossier,
  }
}

// ── Guion ───────────────────────────────────────────────────────────────────────
const trimestre = (fecha: string) => { const l = local(fecha); return `${l.y}-T${Math.ceil(l.m / 3)}` }

// Reels con el guion etiquetado, agrupados por cuenta. Rel = vistas / mediana de los reels de la cuenta en ese trimestre.
export function vistaGuion(piezas: Pieza[], keywords: Map<string, { kc: number; ku: number }>) {
  const reels = piezas.filter((p) => p.tipo_media === "reel" && (p.views ?? 0) > 0)
  const medianas = new Map<string, number | null>()
  const grupos = new Map<string, Pieza[]>()
  for (const p of reels) { const k = `${p.cuenta_fuente}|${trimestre(p.fecha)}`; const l = grupos.get(k) || []; l.push(p); grupos.set(k, l) }
  for (const [k, l] of grupos) medianas.set(k, mediana(l.map((p) => p.views)))
  const cuentas: Record<string, unknown[]> = {}
  const pasajes: Record<string, Array<[string, string]>> = {}
  for (const p of reels) {
    const g = p.guion as Guion | null
    if (!g) continue
    const med = medianas.get(`${p.cuenta_fuente}|${trimestre(p.fecha)}`)
    const views = p.views as number
    const kw = keywords.get(p.id)
    ;(cuentas[`@${p.cuenta_fuente}`] ||= []).push({
      id: p.id, rel: med ? red(views / med, 3) : null, url: p.url, fecha: local(p.fecha).dia, views,
      com_k: red(((p.comentarios ?? 0) / views) * 1000, 3), likes_k: red(((p.likes ?? 0) / views) * 1000, 2),
      th: urlPublica(p.thumb_path), ap: (p.transcript || "").slice(0, 160), radar: true, conf: g.conf,
      topic: g.topic, opening: g.opening, mechanism: g.mechanism, structure: g.structure, evidence: g.evidence,
      emotion: g.emotion, specificity: g.specificity, cta: g.cta, tema_bm: g.tema_bm,
      obj: p.objetivo?.objetivo || "", kw: p.objetivo?.keyword || "",
      kc: kw?.kc ?? null, ku: kw?.ku ?? null, kk: kw ? red((kw.ku / views) * 1000, 3) : null,
      ro: g.ro,
    })
    if (g.tramos?.length) pasajes[p.id] = g.tramos
  }
  for (const l of Object.values(cuentas)) (l as Array<{ fecha: string }>).sort((a, b) => b.fecha.localeCompare(a.fecha))
  return { cuentas, pasajes }
}

// Dónde aparece cada rol (posición del primer tramo, en % del guion) y la secuencia de roles.
export function rolesDeTramos(tramos: Array<[string, string]>) {
  const total = tramos.reduce((t, [texto]) => t + texto.length, 0) || 1
  const pos: Record<string, number> = {}; const sec: string[] = []
  let acum = 0
  for (const [texto, rol] of tramos) {
    if (!(rol in pos)) pos[rol] = Math.round((acum / total) * 100)
    if (sec[sec.length - 1] !== rol) sec.push(rol)
    acum += texto.length
  }
  return { pos, sec }
}

// ── Historias ───────────────────────────────────────────────────────────────────
export function vistaHistorias(historias: Historia[], ultima: { terminado: string | null; costo_usd: number | null } | null, ahora: Date) {
  return {
    generado: ahora.toISOString(),
    historias: historias.map((h) => ({
      id: h.id, cuenta: h.cuenta, fecha: h.fecha, tipo: h.tipo, dur: h.dur,
      caption: h.caption || h.lectura?.texto || "", tx: h.tx || "", st: h.stickers || {}, fr: urlPublica(h.frame_path), url: h.url,
      m: h.metricas, m_at: h.metricas_at, lectura: h.lectura,
    })),
    competencia_ultima: ultima?.terminado ? new Date(ultima.terminado).getTime() / 1000 : null,
    competencia_usd: ultima?.costo_usd ?? null,
  }
}
