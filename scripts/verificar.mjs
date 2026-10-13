// verificar.mjs — revisa que el Radar tenga todo lo que necesita, sin mostrar ninguna clave.
//   npm run verificar
// Mira: variables obligatorias, conexión a Supabase y tablas, token de Apify (y su plan), clave de Claude,
// transcripción (Groq u OpenAI) e Instagram propio (opcional).
import { existsSync, readFileSync } from "node:fs"

if (existsSync(".env.local")) {
  for (const linea of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1")
  }
}
const e = process.env
let fallas = 0
const ok = (m) => console.log(`  ✓ ${m}`)
const mal = (m) => { fallas += 1; console.log(`  ✗ ${m}`) }
const aviso = (m) => console.log(`  · ${m}`)

console.log("Variables obligatorias")
for (const v of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RADAR_PASSWORD", "CRON_SECRET", "APIFY_TOKEN", "ANTHROPIC_API_KEY"]) {
  e[v] ? ok(v) : mal(`${v} vacía`)
}

console.log("Supabase")
if (e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY) {
  for (const t of ["radar_semillas", "radar_piezas", "radar_historias", "radar_corridas", "radar_secuencias", "radar_angulos", "radar_formatos"]) {
    const r = await fetch(`${e.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: e.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`, Prefer: "count=exact" } })
    r.ok ? ok(`${t} (${r.headers.get("content-range")?.split("/")[1] ?? "?"} filas)`) : mal(`${t}: ${r.status} — ¿corriste las migraciones de supabase/migrations?`)
  }
}

console.log("Apify")
if (e.APIFY_TOKEN) {
  const r = await fetch("https://api.apify.com/v2/users/me/limits", { headers: { Authorization: `Bearer ${e.APIFY_TOKEN}` } })
  if (r.ok) {
    const l = (await r.json()).data
    ok(`token válido · gastado este mes US$ ${Number(l.current?.monthlyUsageUsd || 0).toFixed(2)} de ${l.limits?.maxMonthlyUsageUsd ?? "?"}`)
    if (Number(l.limits?.maxMonthlyUsageUsd || 0) <= 5) aviso("plan gratuito de Apify: no permite leer historias. Poné RADAR_PLAN=gratis o pasá a un plan pago (Starter).")
  } else mal(`token rechazado (${r.status})`)
}

console.log("Claude")
if (e.ANTHROPIC_API_KEY) {
  const r = await fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": e.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } })
  r.ok ? ok(`clave válida · modelo ${e.RADAR_MODELO || "claude-opus-5-5"}`) : mal(`clave rechazada (${r.status})`)
}

console.log("Opcionales")
e.GROQ_API_KEY || e.OPENAI_API_KEY ? ok(`transcripción con ${e.GROQ_API_KEY ? "Groq" : "OpenAI"}`) : aviso("sin GROQ_API_KEY ni OPENAI_API_KEY: los reels y las historias no se transcriben")
e.IG_INSIGHTS_TOKEN && e.IG_USER_ID ? ok("Instagram propio (Graph API)") : aviso("sin IG_INSIGHTS_TOKEN / IG_USER_ID: tus historias propias se leen por Apify, sin métricas")
e.NEXT_PUBLIC_BRAND_IG_HANDLE ? ok(`cuenta propia @${e.NEXT_PUBLIC_BRAND_IG_HANDLE.replace(/^@/, "")}`) : aviso("sin NEXT_PUBLIC_BRAND_IG_HANDLE: no hay cuenta propia de base")

console.log(fallas ? `\n${fallas} cosa(s) para resolver.` : "\nTodo listo.")
process.exit(fallas ? 1 : 0)
