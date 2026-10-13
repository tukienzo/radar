# Radar · espiá a tu competencia en Instagram

Seguís las cuentas que querés mirar (competencia, referentes, tu nicho) y el Radar te muestra **qué publican, cuál les
pega y por qué**, todos los días y sin abrir Instagram:

- **Piezas:** reels, carruseles y posts con sus métricas públicas, ordenados por los que más rindieron contra la
  mediana de cada cuenta.
- **Historias:** cada historia capturada antes de que venza, con el texto en pantalla, lo que se dice y los stickers,
  y la secuencia del día armada como ficha (estructura, gancho, CTA, por qué funciona).
- **Análisis con IA:** de cada pieza, formato, hook, ángulo, objetivo (alcance, lead magnet o gatillo), estructura del
  guion y cómo recrearla para tu marca.
- **Cuentas a fondo:** un dossier por cuenta con qué hace, qué le funciona y qué podés tomar.
- **Comentarios:** minería semanal de dolores, objeciones, preguntas y jerga.

Lo lee **Apify**, lo transcribe **Groq** (o OpenAI) y lo analiza **Claude**. Todo queda en tu propio Supabase.

## Viene con una base de arranque

`semilla/` trae **15 cuentas de referencia** del nicho de vender servicios de IA y negocios digitales, con **461
piezas, 351 historias, 73 fichas de secuencias** y 2 resúmenes semanales ya analizados (12/10/2026). Se carga con
`npm run semilla` y no pisa nada. El contenido original es de cada creador: no se incluyen sus imágenes ni videos, sí
el link a cada publicación, el texto leído y el análisis.

## Instalarlo

La forma fácil: abrí este repo con tu agente (Claude Code, Codex, Antigravity, Cursor…) y decile
**«instalá el Radar siguiendo AGENTS.md»**. Te va a pedir las claves y te guía paso a paso.

A mano, en corto:
1. `npm install` y `cp .env.example .env.local`.
2. Proyecto nuevo en Supabase → corré los SQL de `supabase/migrations/` en orden → pegá URL y service key.
3. Claves de Apify, Anthropic y Groq en `.env.local`, más una contraseña (`RADAR_PASSWORD`) y un `CRON_SECRET`.
4. `npm run verificar` → `npm run semilla` → `npm run dev`.
5. Publicá en Vercel. En el plan gratis, prendé los crons de GitHub Actions (ver `AGENTS.md`, paso 6).

## Cuánto sale

Con 13 cuentas, en septiembre de 2026: unos **US$ 16 por mes de Apify** (historias incluidas, plan Starter) más
**US$ 0,05 a 0,08 de Claude por pieza analizada**. Con el plan gratuito de Apify funciona todo menos las historias
(`RADAR_PLAN=gratis`).

## Licencia y uso

Código libre para usar y modificar. Los datos de `semilla/` son lecturas de publicaciones públicas de Instagram, para
análisis y referencia: respetá los derechos de cada creador y las condiciones de Instagram y de Apify.
