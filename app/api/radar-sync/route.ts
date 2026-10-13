import { NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabase-admin"
import { correrPaso, esPaso } from "@/lib/radar/ciclo"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// Cron del Radar. Los crons de Vercel entran por GET con Bearer CRON_SECRET; ?paso= elige qué corre
// (ver lib/radar/ciclo.ts). Sin paso corre el ciclo: recoger, bajar imágenes, transcribir y analizar.
async function correr(request: Request) {
  const secreto = process.env.CRON_SECRET
  if (!secreto) return NextResponse.json({ error: "Falta CRON_SECRET en el servidor" }, { status: 500 })
  if (request.headers.get("authorization") !== `Bearer ${secreto}`) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const q = new URL(request.url).searchParams
  const paso = q.get("paso") || "ciclo"
  if (!esPaso(paso)) return NextResponse.json({ error: "Paso inválido" }, { status: 400 })
  try {
    return NextResponse.json({ paso, ...(await correrPaso(createSupabaseAdmin(), paso, { pedidaPor: "cron", segundos: 250, turno: q.get("turno") || undefined })) })
  } catch (e) {
    console.error("radar-sync", paso, e)
    return NextResponse.json({ paso, error: (e as Error).message }, { status: 500 })
  }
}

export const GET = correr
export const POST = correr
