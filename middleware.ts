import { NextResponse, type NextRequest } from "next/server"
import { COOKIE, sesionValida } from "@/lib/sesion"

// Todo el Radar pide contraseña, salvo el login y el cron (que entra con Bearer CRON_SECRET).
const LIBRES = ["/login", "/api/login", "/api/radar-sync"]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (LIBRES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next()
  if (await sesionValida(request.cookies.get(COOKIE)?.value)) return NextResponse.next()
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  const url = request.nextUrl.clone()
  url.pathname = "/login"
  url.search = ""
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
