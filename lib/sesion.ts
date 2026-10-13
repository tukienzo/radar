// Acceso al Radar: una sola contraseña (RADAR_PASSWORD). Al entrar se guarda una cookie con un hash de la
// contraseña; el middleware la revisa en cada pedido. No hay usuarios ni roles: quien entra, gestiona.
import { cookies } from "next/headers"

export const COOKIE = "radar_sesion"

/** Hash de la contraseña que va en la cookie (funciona en el middleware y en el servidor). */
export async function hashSesion(password: string) {
  const datos = new TextEncoder().encode(`radar:${password}`)
  const digest = await crypto.subtle.digest("SHA-256", datos)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export async function sesionValida(valor: string | undefined) {
  const password = process.env.RADAR_PASSWORD
  if (!password || !valor) return false
  return valor === (await hashSesion(password))
}

/** Quién hace el pedido. Mismo formato que usaba el CRM: con contraseña válida, gestiona todo. */
export async function usuarioActual() {
  const valor = (await cookies()).get(COOKIE)?.value
  if (!(await sesionValida(valor))) return null
  return { email: "radar", nombre: "radar", rol: "admin" }
}
