// importar-semilla.mjs — carga en tu Supabase la base de arranque que viene en semilla/: 15 cuentas de
// referencia con sus piezas, historias, fichas de secuencias y aprendizajes semanales, ya analizados.
// No pisa nada que ya tengas: si una fila existe (misma clave), la deja como está.
//
//   npm run semilla                 importa todo
//   npm run semilla -- --solo-cuentas   solo las 15 cuentas (sin piezas ni historias)
//
// Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .env.local (o del entorno).
import { existsSync, readFileSync } from "node:fs"

if (existsSync(".env.local")) {
  for (const linea of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1")
  }
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const CLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !CLAVE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (en .env.local o en el entorno).")
  process.exit(1)
}

const soloCuentas = process.argv.includes("--solo-cuentas")
const TABLAS = [
  ["semillas", "radar_semillas", "handle"],
  ...(soloCuentas ? [] : [
    ["piezas", "radar_piezas", "id"],
    ["historias", "radar_historias", "id"],
    ["secuencias", "radar_secuencias", "id"],
    ["aprendizajes", "radar_aprendizajes", "semana"],
  ]),
]

async function subir(tabla, clave, filas) {
  let hechas = 0
  for (let i = 0; i < filas.length; i += 100) {
    const lote = filas.slice(i, i + 100)
    const r = await fetch(`${URL}/rest/v1/${tabla}?on_conflict=${clave}`, {
      method: "POST",
      headers: { apikey: CLAVE, Authorization: `Bearer ${CLAVE}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(lote),
    })
    if (!r.ok) throw new Error(`${tabla}: ${r.status} ${(await r.text()).slice(0, 400)}`)
    hechas += lote.length
  }
  return hechas
}

const manifiesto = JSON.parse(readFileSync("semilla/manifiesto.json", "utf8"))
console.log(`Semilla del ${manifiesto.exportado}: ${manifiesto.cuentas.length} cuentas.`)
for (const [archivo, tabla, clave] of TABLAS) {
  const filas = JSON.parse(readFileSync(`semilla/${archivo}.json`, "utf8"))
  const n = await subir(tabla, clave, filas)
  console.log(`  ${tabla}: ${n} filas enviadas (las que ya existían quedaron igual)`)
}
console.log("Listo. Abrí el Radar: las piezas y las historias ya se ven analizadas, sin imágenes (quedan los links a Instagram).")
