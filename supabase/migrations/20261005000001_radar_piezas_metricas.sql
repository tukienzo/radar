-- Métricas reales de las publicaciones propias, leídas con la Graph API de Instagram (token de usuario de sistema).
-- Alcance, vistas, guardados, compartidos e interacciones en todo; tiempo de visualización en reels; visitas al perfil y
-- seguidores ganados en publicaciones del feed (Instagram no los informa en reels). Solo agrega una tabla.
create table if not exists public.radar_piezas_metricas (
  pieza_id text primary key,            -- ig_<shortcode>, el mismo id que radar_piezas
  media_id text not null,
  producto text,                        -- REELS / FEED
  alcance integer,
  vistas integer,
  guardados integer,
  compartidos integer,
  interacciones integer,
  likes integer,
  comentarios integer,
  visitas_perfil integer,
  seguidores integer,
  tiempo_promedio_ms integer,
  tiempo_total_ms bigint,
  historial jsonb not null default '[]'::jsonb,   -- lecturas anteriores (fecha, alcance, vistas), para ver cómo crece
  leido_at timestamptz not null default now()
);
alter table public.radar_piezas_metricas enable row level security;
revoke all on public.radar_piezas_metricas from anon, authenticated;
