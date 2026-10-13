-- Radar → fichas de historias. Cada día de historias de una cuenta seguida se convierte en una "ficha" de
-- secuencia (frames verbatim, estructura con código, por qué funciona, fórmulas, cómo la usaría la marca
-- propia). Una vez por semana se destila lo aprendido.

create table if not exists public.radar_secuencias (
  id text primary key,                 -- '<cuenta>|<AAAA-MM-DD>' (día en hora argentina)
  cuenta text not null,
  dia date not null,
  n_historias integer not null,
  historias text[] not null default '{}',
  ficha jsonb,
  error text,
  modelo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists radar_secuencias_dia on public.radar_secuencias (dia desc);

create table if not exists public.radar_aprendizajes (
  semana text primary key,             -- 2026-W40
  desde date not null,
  hasta date not null,
  n_secuencias integer not null,
  resultado jsonb not null,
  modelo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['radar_secuencias', 'radar_aprendizajes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.radar_touch()', t || '_touch', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
  end loop;
end $$;
