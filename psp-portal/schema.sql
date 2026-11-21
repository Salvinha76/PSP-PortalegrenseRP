-- PSP Portal · correr no Supabase > SQL Editor
create table profiles(
  id uuid primary key references auth.users on delete cascade,
  numero text unique not null, nome text not null, patente text not null, direcao text,
  nivel text not null default 'agente' check (nivel in ('agente','diretor')),
  must_change_password bool not null default true,
  tutorial_done bool not null default false,
  ativo bool not null default true, criado timestamptz default now());
create table efetivos(
  id bigint generated always as identity primary key,
  numero text, nome text not null, patente text, direcao text, estado text default 'Ativo');
create table relatorios(
  id bigint generated always as identity primary key,
  autor uuid references profiles(id), numero text, template text,
  dados jsonb, texto text, anexos jsonb default '[]', criado timestamptz default now());

alter table profiles enable row level security;
alter table efetivos enable row level security;
alter table relatorios enable row level security;

create function is_diretor() returns bool language sql security definer set search_path=public stable as
$$ select exists(select 1 from profiles where id=auth.uid() and nivel='diretor' and ativo) $$;

create policy p_sel on profiles for select to authenticated using (true);
create policy e_sel on efetivos for select to authenticated using (true);
create policy e_all on efetivos for all to authenticated using (is_diretor()) with check (is_diretor());
create policy r_sel on relatorios for select to authenticated using (autor=auth.uid() or is_diretor());
create policy r_ins on relatorios for insert to authenticated with check (autor=auth.uid());

-- Utilizadores só mudam o próprio estado através destas funções (não conseguem mudar o nível)
create function finish_password() returns void language sql security definer set search_path=public as
$$ update profiles set must_change_password=false where id=auth.uid() $$;
create function finish_tutorial() returns void language sql security definer set search_path=public as
$$ update profiles set tutorial_done=true where id=auth.uid() $$;

insert into storage.buckets(id,name,public) values('anexos-relatorios','anexos-relatorios',true) on conflict do nothing;
create policy up_anexos on storage.objects for insert to authenticated with check (bucket_id='anexos-relatorios');

-- ===== ATUALIZAÇÃO (calculadora + relatórios anexos). Se já correste o resto, corre só este bloco =====
alter table relatorios add column if not exists ligados jsonb default '[]';
create policy r_upd on relatorios for update to authenticated using (autor=auth.uid()) with check (autor=auth.uid());
create table autos(
  id bigint generated always as identity primary key,
  autor uuid references profiles(id), numero text, tipo text,
  suspeito jsonb, itens jsonb, total_coima numeric default 0, prisao_meses int default 0,
  relatorios jsonb default '[]', texto text, criado timestamptz default now());
alter table autos enable row level security;
create policy a_sel on autos for select to authenticated using (autor=auth.uid() or is_diretor());
create policy a_ins on autos for insert to authenticated with check (autor=auth.uid());
create policy a_upd on autos for update to authenticated using (autor=auth.uid()) with check (autor=auth.uid());
-- ===== fim da atualização =====

-- ===== SÓ DEPOIS de criares o utilizador 2026002@psp.rp em Authentication > Users =====
insert into profiles(id,numero,nome,patente,direcao,nivel,must_change_password,tutorial_done)
select id,'2026002','Salvas Correia','Dir. Nac. Adj.','Direção Nacional','diretor',false,true
from auth.users where email='2026002@psp.rp';
