# Radar · instrucciones para el agente

Sos el agente que instala y opera el Radar para la persona que te lo pidió. El Radar es una app web (Next.js 16 +
Supabase) que sigue cuentas de Instagram (competencia y referentes), lee lo que publican con **Apify** (reels,
carruseles, posts, historias, perfiles y comentarios), transcribe lo hablado (Groq u OpenAI) y lo analiza con
**Claude**: formato, hook, ángulo, objetivo, estructura del guion, por qué funciona y cómo recrearlo para la marca de
la persona. Trae una base de arranque (`semilla/`) con 15 cuentas de referencia del nicho «vender servicios de IA /
negocios digitales» ya leídas y analizadas.

## Reglas

- **Claves:** las pide y las pega la persona; vos nunca las inventás, nunca las imprimís en la consola y nunca las
  subís al repo. `.env.local` está en `.gitignore`. En el hosting se cargan como variables de entorno.
- **Cuentas:** no crees cuentas (Supabase, Apify, Anthropic, Vercel) por la persona: guiala para que las cree ella.
- **Gasto:** Apify y Claude cobran por uso. Antes de lanzar lecturas grandes, decile cuánto va a costar más o menos
  (tabla de abajo). `RADAR_TOPE_USD` frena cada corrida de Apify en ese monto.
- **Comprobá cada paso** (`npm run verificar`, abrir la página, mirar Semillas → corridas) antes de decir que quedó.

## Instalación (en orden)

### 0. Requisitos
Node 20 o más nuevo, git y cuentas en: Supabase (gratis alcanza), Apify (gratis para probar; para historias hace
falta un plan pago, Starter), Anthropic (API, se paga por uso), Groq (gratis, para transcribir) y Vercel (o cualquier
hosting de Next.js). Opcional: un token de la Graph API de Instagram para leer las historias propias con métricas.

### 1. El código
```bash
git clone https://github.com/tukienzo/radar.git && cd radar
npm install
cp .env.example .env.local
```

### 2. La base (Supabase)
1. La persona crea un proyecto nuevo en supabase.com y te pasa la **Project URL** y la **service_role key**
   (Project Settings → API). Van en `.env.local` como `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
2. Corré las migraciones de `supabase/migrations/`, **en orden de nombre**. Dos caminos:
   - CLI: `npx supabase login`, `npx supabase link --project-ref <ref>` y `npx supabase db push`.
   - Sin CLI: pegá cada archivo `.sql`, en orden, en el **SQL Editor** de Supabase y ejecutalo.
   Crean las tablas `radar_*` y el bucket público `radar` (miniaturas y frames).

### 3. Las claves
Completá `.env.local` (cada variable está explicada en `.env.example`): `RADAR_PASSWORD` (la elige la persona),
`CRON_SECRET` (generá uno al azar: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`),
`APIFY_TOKEN`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY` y los datos de la marca (`NEXT_PUBLIC_BRAND_NAME`,
`NEXT_PUBLIC_BRAND_IG_HANDLE`, `RADAR_OFERTA`, `RADAR_CLIENTE_IDEAL`…). **Preguntale a la persona por su negocio**
para completar los `RADAR_*`: es lo que hace que Claude analice y recree pensando en su marca.

Después: `npm run verificar`. Tiene que terminar en «Todo listo».

### 4. La base de arranque (opcional, recomendado)
```bash
npm run semilla
```
Carga las 15 cuentas de referencia con 461 piezas, 351 historias, 73 fichas de secuencias y 2 resúmenes semanales,
ya analizados (exportados el 12/10/2026). No pisa nada. Si la persona no quiere esas cuentas:
`npm run semilla -- --solo-cuentas` (solo la lista) o no lo corras. Las piezas vienen **sin imágenes** (el contenido
es de cada creador: queda el link a la publicación original); las nuevas que lea el Radar sí bajan su miniatura.

### 5. Probar en local
```bash
npm run dev
```
Abrí http://localhost:3000, entrá con `RADAR_PASSWORD`, mirá la pestaña **Semillas**: tiene que decir «todo
conectado». Probá **Sincronizar → Piezas** con una cuenta y después **Procesar lo que llegó**.

### 6. Publicar (Vercel)
```bash
npx vercel link
npx vercel env add <VARIABLE> production   # una por cada variable de .env.local
npx vercel --prod
```
- **Vercel Pro:** los crons de `vercel.json` corren solos (ciclo cada 10 minutos, historias dos veces por día…).
- **Vercel Hobby (gratis):** solo permite crons diarios y el deploy falla con los de `vercel.json`. Dejá
  `vercel.json` como `{"crons": []}`, copiá `extras/radar-crons.yml` a `.github/workflows/radar-crons.yml` y prendelo: en el repo de la persona, variable
  `RADAR_CRON_GITHUB=true` y secretos `RADAR_URL` y `CRON_SECRET` (Settings → Secrets and variables → Actions).
- Otro hosting: cualquier cron externo que llame `GET /api/radar-sync?paso=<paso>` con
  `Authorization: Bearer <CRON_SECRET>` (los horarios están en `vercel.json`).

## Operar

| Qué | Dónde |
|---|---|
| Sumar o pausar cuentas | Pestaña **Semillas** (pegá varias juntas: `@cuenta`, link o nombre). Tag `propia` = tu cuenta (base de comparación, no se recrea) |
| Leer ya, sin esperar el cron | **Semillas → Sincronizar**: piezas, historias, perfiles, comentarios, procesar, minar |
| Ver qué pegó esta semana | **Semana** y **Grilla** (outliers contra la mediana de cada cuenta) |
| Analizar una cuenta a fondo | **Cuentas** → dossier (necesita 5+ piezas analizadas) |
| Guiones y estructura | **Guion** (anatomía de los reels) e **Historias** (fichas de secuencias del día) |
| Tu banco de ángulos | Tabla `radar_angulos` en Supabase (número, título, etapa). Claude clasifica cada pieza con esos números |
| Formatos | Tabla `radar_formatos` (viene con 9 de partida) |
| Desde la terminal | `npm run radar -- estado` · `piezas` · `historias` · `ciclo` · `datos` (ver `scripts/radar-local.ts`) |

## Costos de referencia (medidos en septiembre de 2026 con 13 cuentas)

| Qué | Costo |
|---|---|
| Apify, piezas | US$ 0,0027 por pieza leída |
| Apify, perfiles y comentarios | US$ 0,0026 por perfil o comentario |
| Apify, historias | US$ 0,14 por corrida con 13 cuentas; **requiere plan pago** (Starter, US$ 19/mes) |
| Plan `estandar` completo | unos US$ 16 por mes de Apify |
| Claude, análisis | US$ 0,05 a 0,08 por pieza · US$ 0,16 por recreación · US$ 0,05 por ficha de historias |
| Groq (transcripción) | gratis dentro de sus límites |

## Apify desde el agente (opcional)

La app no necesita MCP: usa `APIFY_TOKEN` directo. Si además querés que el agente consulte Apify (probar un actor,
mirar una corrida), está `.mcp.json` con el servidor oficial (`https://mcp.apify.com`, pide login la primera vez).
En Codex (`~/.codex/config.toml`):
```toml
[mcp_servers.apify]
command = "npx"
args = ["-y", "@apify/actors-mcp-server"]
env = { APIFY_TOKEN = "<el token de la persona>" }
```

## Mapa del código

- `lib/radar/` — todo el Radar: `apify.ts` (cliente y actores), `ingesta.ts` (lanzar y recoger corridas),
  `medios.ts` (imágenes al bucket), `transcribir.ts`, `analisis.ts` (Claude), `graph.ts` + `media-propia.ts`
  (Instagram propio), `metricas.ts` (outliers, medianas), `lectura.ts` (lo que ve la página), `ciclo.ts` (los pasos).
- `app/api/radar/*` — la API que usa la página · `app/api/radar-sync` — el cron.
- `public/radar/index.html` — la página entera (HTML + JS, sin build).
- `lib/negocio.ts` + `lib/brand.ts` — el contexto de la marca que recibe Claude.
- `middleware.ts` + `lib/sesion.ts` — la contraseña.
- `semilla/` + `scripts/importar-semilla.mjs` — la base de arranque.
