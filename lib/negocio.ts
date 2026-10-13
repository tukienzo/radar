// Contexto del negocio que recibe Claude en cada lectura del Radar (análisis de piezas, dossiers, recreaciones
// y fichas de historias). Se completa con variables de entorno (o editando los textos por defecto de acá).
// Mientras digan "sin cargar", Claude analiza con un contexto genérico.
//
// El texto es estable a propósito (sin fechas): es el prefijo que se cachea entre llamadas a la API.
import { BRAND } from "@/lib/brand"

const txt = (v: string | undefined, porDefecto: string) => String(v ?? "").trim() || porDefecto

/** Qué vende el negocio y qué promete, en dos o tres oraciones. */
export const OFERTA = txt(process.env.RADAR_OFERTA, "Sin cargar: describí qué vendés, qué resultado promete y cómo se entrega.")

/** A quién le habla el contenido: edad, situación, dolores reales (idealmente con frases textuales). */
export const CLIENTE_IDEAL = txt(process.env.RADAR_CLIENTE_IDEAL, "Sin cargar: describí al cliente ideal (quién es, qué le pasa hoy, qué quiere lograr y qué lo frena).")

/** Mercado, idioma y canales de adquisición. */
export const MERCADO = txt(process.env.RADAR_MERCADO, "Mercado hispanohablante. Adquisición: contenido orgánico de Instagram, mensajes directos con palabra clave y llamada de venta.")

/** Reglas de comunicación que no se negocian (una por línea, empezando con "- "). */
export const REGLAS = txt(process.env.RADAR_REGLAS, `- Prohibido prometer resultados garantizados, exagerar casos de éxito o inventar cifras.
- Idioma: español neutro, directo y cotidiano, sin relleno corporativo ni lenguaje de gurú.`)

/** Mezcla del mes por etapa de consciencia. */
export const MEZCLA = txt(process.env.RADAR_MEZCLA, "40 % problema, 30 % mentalidad, 20 % solución, 10 % producto.")

export function contextoNegocio(): string {
  const cuenta = BRAND.igArroba ? ` La cuenta de Instagram es ${BRAND.igArroba}.` : ""
  return `${BRAND.name}: ${OFERTA}${cuenta} ${MERCADO} CTA habitual: comentar o mandar por DM la palabra "${BRAND.ctaKeyword}" a cambio de un recurso.

A QUIÉN LE HABLA EL CONTENIDO
${CLIENTE_IDEAL}

REGLAS QUE NO SE NEGOCIAN
${REGLAS}

ETAPAS DE CONSCIENCIA (la taxonomía del banco de ángulos)
- tofu / volumen: pieza de alcance (herramientas, listas, comparativas), sin bajada a producto.
- problema: nombra el dolor del cliente ideal.
- solucion: muestra el camino.
- producto: caso de éxito o el programa.
- mentalidad: historia personal, procrastinación, creencias.
Mezcla del mes: ${MEZCLA}`
}
