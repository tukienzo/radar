/* Marca del Radar. Sale de variables de entorno, así el código no trae ningún nombre propio.
   NEXT_PUBLIC_BRAND_NAME: tu negocio (va en los textos que lee Claude y en la pestaña del navegador).
   NEXT_PUBLIC_BRAND_IG_HANDLE: tu cuenta de Instagram sin @ (sirve de base de comparación, no se recrea). */

const txt = (v: string | undefined, porDefecto = "") => String(v ?? "").trim() || porDefecto
const handle = txt(process.env.NEXT_PUBLIC_BRAND_IG_HANDLE).replace(/^@/, "").toLowerCase()

export const BRAND = {
  name: txt(process.env.NEXT_PUBLIC_BRAND_NAME, "Mi marca"),
  igHandle: handle,
  igArroba: handle ? `@${handle}` : "",
  ctaKeyword: txt(process.env.NEXT_PUBLIC_BRAND_CTA_KEYWORD, "INFO").toUpperCase(),
}
