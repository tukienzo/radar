// Los pasos del Radar, tal como los corre el cron (/api/radar-sync) o el botón "Sincronizar" de la página.
//
//   piezas · perfiles · historias · comentarios   lanzan una corrida de Apify (no esperan el resultado)
//   propias                                       lee las historias de la cuenta propia por la Graph API
//   ciclo                                         recoge lo que terminó, baja imágenes, transcribe y analiza,
//                                                 hasta donde alcance el tiempo de la función
//   minar                                         minería de comentarios de la semana
//   podar                                         borra imágenes viejas
//   metricas                                      publicaciones propias y sus métricas reales por la Graph API
//                                                 (alcance, vistas, guardados, compartidos, seguidores), gratis

import type { SupabaseClient } from "@supabase/supabase-js"
import { analizarPendientes, leerHistoriasPendientes, minarSemana } from "./analisis"
import { apifyListo, planRadar, presupuesto } from "./apify"
import { graphListo, sincronizarPropias } from "./graph"
import { lanzarComentarios, lanzarHistorias, lanzarPerfiles, lanzarPiezas, recoger } from "./ingesta"
import { descargarMedios, podarMedios } from "./medios"
import { local } from "./metricas"
import { transcribirPendientes } from "./transcribir"
import { sincronizarMediaPropia } from "./media-propia"

export const PASOS = ["piezas", "perfiles", "historias", "comentarios", "propias", "ciclo", "minar", "podar", "metricas"] as const
export type Paso = (typeof PASOS)[number]

const SIN_APIFY = { ok: false, motivo: "falta APIFY_TOKEN: conectá Apify para que el Radar pueda leer Instagram" }

const LECTURAS: Paso[] = ["piezas", "perfiles", "historias", "comentarios"]

// Lo que el cron saltea según el plan. Lo que se pide a mano desde la página corre siempre.
function salteaElCron(paso: Paso) {
  const plan = planRadar()
  if (plan === "completo") return null
  const dia = local(new Date()).dow
  if (plan === "estandar") {
    if (paso === "piezas" && !["Mon", "Wed", "Fri"].includes(dia)) return "plan estándar: las piezas se leen lunes, miércoles y viernes"
    return null
  }
  if (paso === "piezas" && !["Mon", "Thu"].includes(dia)) return "plan gratis: las piezas se leen lunes y jueves"
  // El plan gratuito de Apify no deja usar los actores de historias (devuelven una muestra y cobran igual).
  if (paso === "historias") return "plan gratis: Apify no permite leer historias"
  if (paso === "comentarios") return "plan gratis: los comentarios se bajan a mano desde Sincronizar"
  return null
}

export async function correrPaso(db: SupabaseClient, paso: Paso, o: { pedidaPor?: string; segundos?: number; cuentas?: string[]; dias?: number; turno?: string } = {}) {
  const hasta = Date.now() + (o.segundos || 240) * 1000
  const pedidaPor = o.pedidaPor || "cron"
  if (LECTURAS.includes(paso) && apifyListo()) {
    const salteo = pedidaPor === "cron" ? salteaElCron(paso) : null
    if (salteo) return { ok: false, motivo: salteo }
    const p = await presupuesto()
    if (p?.agotado) return { ok: false, motivo: `Apify llegó al tope del mes (US$ ${p.usado} de ${p.tope}). Se renueva el ${p.renueva?.slice(0, 10) || "próximo ciclo"}.`, presupuesto: p }
  }
  switch (paso) {
    case "piezas": return apifyListo() ? lanzarPiezas(db, { pedidaPor, cuentas: o.cuentas, dias: o.dias }) : SIN_APIFY
    case "perfiles": return apifyListo() ? lanzarPerfiles(db, { pedidaPor }) : SIN_APIFY
    // Sin token de Instagram, las historias propias también se piden por Apify (sin métricas, pero quedan guardadas).
    case "historias": return apifyListo() ? lanzarHistorias(db, { pedidaPor: pedidaPor === "cron" ? (o.turno === "2" ? "cron (rechequeo)" : "cron") : pedidaPor, incluirPropias: !graphListo() }) : SIN_APIFY
    case "comentarios": return apifyListo() ? lanzarComentarios(db, { pedidaPor }) : SIN_APIFY
    case "propias": return sincronizarPropias(db)
    case "minar": return minarSemana(db)
    case "podar": return podarMedios(db)
    case "metricas": return sincronizarMediaPropia(db, { hasta })
    case "ciclo": {
      const recogidas = apifyListo() ? await recoger(db) : []
      // Cada tramo tiene su parte del tiempo, para que una cola larga de imágenes no deje sin turno al análisis.
      const total = hasta - Date.now()
      const medios = await descargarMedios(db, Date.now() + total * 0.35)
      const voz = await transcribirPendientes(db, Date.now() + total * 0.25)
      const analisis = await analizarPendientes(db, hasta - total * 0.1)
      const historias = Date.now() < hasta - 20000 ? await leerHistoriasPendientes(db, hasta) : { leidas: 0, secuencias: 0, fallidas: 0, corte: "tiempo" }
      if (analisis.analizadas || ("secuencias" in historias && historias.secuencias)) {
        const uso = "uso" in historias ? { entrada: analisis.uso.entrada + historias.uso.entrada, salida: analisis.uso.salida + historias.uso.salida, cache: analisis.uso.cache + historias.uso.cache, llamadas: analisis.uso.llamadas + historias.uso.llamadas } : analisis.uso
        await db.from("radar_corridas").insert({ tipo: "analisis", estado: "recogida", actor: "claude", items: analisis.analizadas + historias.leidas, nuevos: analisis.analizadas, pedida_por: pedidaPor, terminado: new Date().toISOString(), detalle: { uso, fallidas: analisis.fallidas, corte: analisis.corte } })
      }
      return { ok: true, recogidas, medios, voz, analisis: { ...analisis, uso: undefined }, historias: { ...historias, uso: undefined } }
    }
  }
}

export const esPaso = (v: unknown): v is Paso => typeof v === "string" && (PASOS as readonly string[]).includes(v)
