import { NextResponse } from "next/server"
import { COOKIE, hashSesion } from "@/lib/sesion"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const password = process.env.RADAR_PASSWORD
  if (!password) return NextResponse.json({ error: "Falta RADAR_PASSWORD en el servidor" }, { status: 500 })
  const form = await request.formData().catch(() => null)
  const intento = String(form?.get("password") || "")
  const destino = new URL("/", request.url)
  if (intento !== password) {
    destino.pathname = "/login"
    destino.searchParams.set("error", "1")
    return NextResponse.redirect(destino, 303)
  }
  const r = NextResponse.redirect(destino, 303)
  r.cookies.set(COOKIE, await hashSesion(password), { httpOnly: true, sameSite: "lax", secure: destino.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 30 })
  return r
}
