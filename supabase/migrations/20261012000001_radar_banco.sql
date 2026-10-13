-- Banco de ángulos y catálogo de formatos que Claude usa para clasificar cada pieza (lib/radar/contexto.ts).
-- En el CRM vivían en crm_angulos y crm_formatos; acá son tablas propias del Radar. Se editan desde el
-- editor de tablas de Supabase: los cambios llegan al próximo análisis sin tocar código.

create table if not exists public.radar_angulos (
  numero integer primary key,
  titulo text not null,
  etapa text,                          -- problema | solucion | producto | mentalidad | tofu
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.radar_formatos (
  nombre text primary key,
  tipo text not null,                  -- reel | carrusel | post | historia
  activo boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['radar_angulos', 'radar_formatos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
  end loop;
end $$;

-- Formatos de partida (se pueden borrar o renombrar). El banco de ángulos arranca vacío: cargá los tuyos,
-- uno por fila, con su número; Claude devuelve 0 cuando ninguno aplica.
insert into public.radar_formatos (nombre, tipo, orden) values
  ('TALKING HEAD', 'reel', 1),
  ('GREEN SCREEN', 'reel', 2),
  ('CÁMARA EN MANO', 'reel', 3),
  ('PANTALLA DIVIDIDA', 'reel', 4),
  ('YAPPING', 'reel', 5),
  ('TUTORIAL EN PANTALLA', 'reel', 6),
  ('B-ROLL CON TEXTO', 'reel', 7),
  ('CARRUSEL', 'carrusel', 8),
  ('POST', 'post', 9)
on conflict (nombre) do nothing;
