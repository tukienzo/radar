// radar-local.ts — corre un paso del Radar desde la compu, contra la base real, con las claves de .env.local.
// Sirve para probar y para adelantar una corrida sin esperar al cron.
//
//   npx tsx scripts/radar-local.ts estado
//   npx tsx scripts/radar-local.ts sembrar [cuenta…]     carga cuentas a seguir (no pisa las que ya están)
//   npx tsx scripts/radar-local.ts piezas [dias] [porCuenta]
//   npx tsx scripts/radar-local.ts perfiles | historias | comentarios | propias | ciclo | minar | podar
//   npx tsx scripts/radar-local.ts adoptar <tipo> <runId> <datasetId>   registra una corrida de Apify ya hecha
//   npx tsx scripts/radar-local.ts datos                 arma lo que ve la página y lo guarda en scripts/out/radar-datos.json
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

for (const linea of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1")
}

// Cuentas que carga "sembrar": las que pases como argumentos ("sembrar cuenta1 cuenta2"), más la
// propia (NEXT_PUBLIC_BRAND_IG_HANDLE) como base de comparación. El Radar arranca sin cuentas seguidas.
function semillas(handles: string[]): Array<{ handle: string; tags: string[]; historias: boolean; nota: string }> {
  const propia = String(process.env.NEXT_PUBLIC_BRAND_IG_HANDLE || "").replace(/^@/, "").toLowerCase().trim()
  const lista = handles.map((h) => h.replace(/^@/, "").toLowerCase().trim()).filter(Boolean)
  return [
    ...(propia ? [{ handle: propia, tags: ["propia"], historias: true, nota: "cuenta propia: base de comparación, no se recrea" }] : []),
    ...lista.filter((h) => h !== propia).map((handle) => ({ handle, tags: ["referente"], historias: true, nota: "" })),
  ]
}

async function main() {
  const [comando, ...args] = process.argv.slice(2)
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { autoRefreshToken: false, persistSession: false } })
  const { correrPaso, esPaso } = await import("../lib/radar/ciclo")
  const { estadoRadar, datosRadar, historiasRadar, guionRadar, indiceCuentas, cuentaAFondo } = await import("../lib/radar/lectura")

  if (comando === "estado") return console.log(JSON.stringify(await estadoRadar(db), null, 1))

  if (comando === "sembrar") {
    const { data: ya } = await db.from("radar_semillas").select("handle")
    const existentes = new Set((ya || []).map((s) => s.handle))
    const nuevas = semillas(args).filter((s) => !existentes.has(s.handle)).map((s) => ({ ...s, creado_por: "carga inicial" }))
    if (nuevas.length) { const { error } = await db.from("radar_semillas").insert(nuevas); if (error) throw new Error(error.message) }
    return console.log(`cuentas nuevas: ${nuevas.map((s) => s.handle).join(", ") || "ninguna"} · total ${existentes.size + nuevas.length}`)
  }

  if (comando === "adoptar") {
    const [tipo, runId, datasetId] = args
    const { error } = await db.from("radar_corridas").insert({ tipo, actor: "prueba", apify_run_id: runId, apify_dataset_id: datasetId, cuentas: [], pedida_por: "prueba local" })
    if (error) throw new Error(error.message)
    return console.log("corrida registrada; corré 'ciclo' para recogerla")
  }

  if (comando === "datos") {
    mkdirSync("scripts/out", { recursive: true })
    const datos = await datosRadar(db)
    const indice = await indiceCuentas(db)
    const primera = Object.keys(indice)[0]
    const salida = { datos, historias: await historiasRadar(db), guion: await guionRadar(db), pasajes: await guionRadar(db, true), cuentas: indice, cuenta: primera ? await cuentaAFondo(db, primera) : null, estado: await estadoRadar(db) }
    writeFileSync("scripts/out/radar-datos.json", JSON.stringify(salida))
    return console.log(`piezas ${datos.piezas.length} · semillas ${datos.semillas.length} · kpis ${JSON.stringify(datos.kpis)} · ${Math.round(JSON.stringify(datos).length / 1024)} KB`)
  }

  if (!esPaso(comando)) throw new Error(`comando desconocido: ${comando}`)
  const r = await correrPaso(db, comando, { pedidaPor: "prueba local", segundos: Number(process.env.RADAR_SEGUNDOS || 240), dias: Number(args[0]) || undefined })
  console.log(JSON.stringify(r, null, 1))
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1) })
