// El contexto del negocio que recibe Claude en cada lectura del Radar: la descripción del negocio
// (lib/negocio.ts) más el banco de ángulos y el catálogo de formatos, que se leen de la base para
// que lo que se edite en las tablas radar_angulos y radar_formatos llegue al análisis sin tocar código.
//
// El texto es estable a propósito (sin fechas ni datos que cambien por pedido): es el prefijo que se
// cachea entre llamadas.

import type { SupabaseClient } from "@supabase/supabase-js"
import { BRAND } from "@/lib/brand"
import { contextoNegocio } from "@/lib/negocio"

export const NEGOCIO = contextoNegocio()

export type Banco = { angulos: Array<{ numero: number; titulo: string }>; formatos: Array<{ nombre: string; tipo: string }> }

export async function leerBanco(db: SupabaseClient): Promise<Banco> {
  const [a, f] = await Promise.all([
    db.from("radar_angulos").select("numero,titulo,activo").eq("activo", true).order("numero", { ascending: true }),
    db.from("radar_formatos").select("nombre,tipo,activo,orden").eq("activo", true).order("orden", { ascending: true }),
  ])
  return {
    angulos: (a.data || []).map((x) => ({ numero: Number(x.numero), titulo: String(x.titulo) })),
    formatos: (f.data || []).map((x) => ({ nombre: String(x.nombre), tipo: String(x.tipo) })),
  }
}

export function textoBanco(b: Banco) {
  const angulos = b.angulos.length ? b.angulos.map((a) => `${a.numero} · ${a.titulo}`).join("\n") : "(banco vacío)"
  const formatos = b.formatos.length ? b.formatos.map((f) => `${f.nombre} (${f.tipo})`).join(" · ") : "(catálogo vacío)"
  return `BANCO DE ÁNGULOS DE ${BRAND.name} (número · título). Usá el número; 0 si ninguno aplica. No inventes ángulos.\n${angulos}\n\nCATÁLOGO DE FORMATOS\n${formatos}`
}
