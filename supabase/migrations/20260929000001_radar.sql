-- Radar de contenido (Marketing → Radar).
-- Sigue cuentas de Instagram ("semillas"): las piezas que publican (reels, carruseles, posts) con sus
-- métricas públicas, las historias antes de que venzan y los comentarios. Las piezas y las historias de
-- terceros llegan por Apify; las historias propias, con sus métricas, por la Graph API de Instagram.
-- El análisis (formato, hook, ángulo, objetivo, cómo recrearlo) lo hace Claude.
--
-- Las métricas derivadas (outlier, tasa, score, velocidad) NO se guardan: dependen de la fecha de hoy y de
-- la mediana de la cuenta, así que se calculan al leer (lib/radar/metricas.ts).

create table if not exists public.radar_semillas (
  handle text primary key,                       -- sin @, en minúsculas
  tags text[] not null default '{}',             -- 'propia' = cuenta nuestra (baseline, no se recrea) · competencia · referente · nicho
  activa boolean not null default true,          -- inactiva = no se vuelve a leer, el histórico queda
  historias boolean not null default true,       -- si además se le capturan las historias (se paga por cuenta y por día)
  nota text,
  nombre text,
  bio text,
  foto_path text,
  foto_remota text,                              -- url de Instagram pendiente de bajar al bucket
  seguidores integer,
  posts integer,
  perfil_at timestamptz,                         -- última lectura del perfil
  dossier jsonb,                                 -- "qué hace y qué le robamos", generado a pedido
  dossier_at timestamptz,
  creado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.radar_piezas (
  id text primary key,                           -- 'ig_<shortCode>'
  plataforma text not null default 'ig',
  cuenta text not null,                          -- quien la publicó
  cuenta_fuente text not null,                   -- semilla en cuyo perfil se vio (difiere en las colaboraciones)
  url text not null,
  tipo_media text not null,                      -- reel | carrusel | post
  fecha timestamptz not null,                    -- publicación
  caption text,
  likes integer,
  comentarios integer,
  views integer,                                 -- null = dato no público (posts sin video, carruseles)
  duracion numeric,                              -- segundos, solo reels
  fijado boolean not null default false,
  thumb_path text,                               -- bucket radar
  thumb_remota text,                             -- url de Instagram pendiente de bajar (vence en días)
  slides jsonb,                                  -- carrusel: [{ n, path, texto, visual }]
  slides_remotas jsonb,                          -- urls de las slides pendientes de bajar
  video_url text,                                -- url temporal del video (vence en horas): solo para transcribir
  video_url_at timestamptz,
  transcript text,
  transcript_error text,
  analisis jsonb,                                -- formato, tipo, hook, estructura, cta, keyword, ángulo, recreable…
  analisis_at timestamptz,
  analisis_error text,
  objetivo jsonb,                                -- { objetivo: alcance | lead_magnet | gatillo, keyword, c }
  guion jsonb,                                   -- anatomía del guion: 9 dimensiones + confianza + tramos con su rol
  lectura jsonb,                                 -- carrusel: { diseno, estructura, cierre }
  recreacion jsonb,                              -- versión para la marca propia: reel + carrusel + historias + hooks
  recreacion_at timestamptz,
  visto_at timestamptz not null default now(),   -- primera vez que el radar la vio
  medido_at timestamptz not null default now(),  -- última lectura de métricas
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists radar_piezas_fecha on public.radar_piezas (fecha desc);
create index if not exists radar_piezas_cuenta_fecha on public.radar_piezas (cuenta_fuente, fecha desc);
create index if not exists radar_piezas_sin_analisis on public.radar_piezas (fecha desc) where analisis is null;

create table if not exists public.radar_historias (
  id text primary key,                           -- id del medio en Instagram
  cuenta text not null,
  fecha timestamptz not null,                    -- publicación
  vence timestamptz,
  tipo text,                                     -- foto | video
  dur numeric,
  caption text,                                  -- texto en pantalla
  tx text,                                       -- lo hablado (videos con voz)
  stickers jsonb not null default '{}'::jsonb,   -- { links:[], encuestas:[], preguntas:[], menciones:[], musica:true }
  frame_path text,                               -- bucket radar
  frame_remota text,                             -- url de Instagram pendiente de bajar
  video_url text,
  video_url_at timestamptz,
  tx_error text,
  url text,
  metricas jsonb,                                -- solo cuentas propias: alcance, respuestas, salidas, avances, visitas…
  metricas_at timestamptz,
  lectura jsonb,                                 -- tipo de historia (hand raiser, CTA, why now…) y rol en la secuencia
  fuente text not null default 'apify',          -- apify | graph
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists radar_historias_cuenta_fecha on public.radar_historias (cuenta, fecha desc);
create index if not exists radar_historias_fecha on public.radar_historias (fecha desc);

-- Una fila por corrida (lanzada a Apify o hecha contra la Graph API): qué se pidió, qué trajo y cuánto costó.
create table if not exists public.radar_corridas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,                            -- piezas | perfiles | historias | comentarios | propias | analisis
  estado text not null default 'lanzada',        -- lanzada | recogida | error
  actor text,
  apify_run_id text,
  apify_dataset_id text,
  cuentas text[] not null default '{}',
  items integer,
  nuevos integer,
  costo_usd numeric,
  error text,
  detalle jsonb,
  pedida_por text,                               -- 'cron' o el nombre de quien tocó "Sincronizar"
  iniciado timestamptz not null default now(),
  terminado timestamptz
);
create index if not exists radar_corridas_estado on public.radar_corridas (estado, iniciado desc);
create index if not exists radar_corridas_tipo on public.radar_corridas (tipo, iniciado desc);

create table if not exists public.radar_comentarios_crudos (
  id text primary key,
  pieza_id text not null,
  cuenta text not null,                          -- dueño de la pieza
  usuario text,
  texto text not null,
  likes integer,
  fecha timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists radar_comentarios_crudos_fecha on public.radar_comentarios_crudos (fecha desc);
create index if not exists radar_comentarios_crudos_pieza on public.radar_comentarios_crudos (pieza_id);

-- La minería de comentarios de cada semana: dolores, objeciones, preguntas, jerga e ideas de contenido.
create table if not exists public.radar_comentarios (
  semana text primary key,                       -- 2026-W39
  n_comentarios integer not null default 0,
  resultado jsonb not null,
  modelo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.radar_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['radar_semillas', 'radar_piezas', 'radar_historias', 'radar_comentarios'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.radar_touch()', t || '_touch', t);
  end loop;
  foreach t in array array['radar_semillas', 'radar_piezas', 'radar_historias', 'radar_corridas', 'radar_comentarios_crudos', 'radar_comentarios'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
  end loop;
end $$;

-- Qué piezas tienen transcript, slides o recreación, sin traer el contenido (la grilla solo necesita saberlo).
create or replace function public.radar_banderas(desde timestamptz)
returns table (id text, t boolean, s integer, r boolean)
language sql stable security definer set search_path = public as $$
  select p.id,
         (p.transcript is not null and p.transcript <> ''),
         case when jsonb_typeof(p.slides) = 'array' then jsonb_array_length(p.slides) else 0 end,
         (p.recreacion is not null)
  from public.radar_piezas p
  where p.fecha >= desde
  order by p.id
$$;
revoke all on function public.radar_banderas(timestamptz) from public, anon, authenticated;
grant execute on function public.radar_banderas(timestamptz) to service_role;

-- Miniaturas, slides y frames de historias. Son imágenes de publicaciones públicas de Instagram, ya
-- reducidas; el bucket es público para que la grilla las pida directo al CDN sin pasar por una función.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('radar', 'radar', true, 2097152, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- El radar arranca sin cuentas seguidas: la cuenta propia (tag 'propia', sirve de baseline y no se
-- recrea) y las demás se agregan desde Radar → Semillas.
