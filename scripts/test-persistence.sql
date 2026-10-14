\set ON_ERROR_STOP on
-- Disposable PostgreSQL fixture only. Never run this against an existing project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create schema storage;
create table storage.buckets(
  id text primary key, name text not null, public boolean not null,
  file_size_limit bigint, allowed_mime_types text[]
);
\ir ../supabase/migrations/001_tabletop.sql
\ir ../supabase/migrations/002_assets_and_membership.sql
insert into auth.users values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003');

create function pg_temp.snapshot(p_name text, p_player boolean) returns jsonb language sql as $$
  select jsonb_build_object(
    'state', jsonb_build_object('id','migration-room','name',p_name,'revision',5),
    'members', jsonb_build_object(
      '00000000-0000-4000-8000-000000000001', jsonb_build_object('name','Owner','role','gm')
    ) || case when p_player then jsonb_build_object(
      '00000000-0000-4000-8000-000000000002', jsonb_build_object('name','Player','role','player')
    ) else '{}'::jsonb end
  )
$$;
grant usage on schema pg_temp to service_role;
grant execute on function pg_temp.snapshot(text,boolean) to service_role;
-- Simulate a real pre-migration snapshot and memberships.
set role service_role;
select public.save_room_snapshot('migration-room', '00000000-0000-4000-8000-000000000001',
  'Legacy room', 5, pg_temp.snapshot('Legacy room', true));
reset role;
\ir ../supabase/migrations/003_snapshot_save_version.sql
set role service_role;

do $$
declare v bigint;
begin
  if (select save_version from public.room_snapshots where campaign_id='migration-room') <> 0 then
    raise exception 'Legacy snapshots must start at version zero';
  end if;
  -- Same gameplay revision, changed membership: durable save version must advance.
  v := public.save_room_snapshot('migration-room', '00000000-0000-4000-8000-000000000001',
    'Winner', 5, pg_temp.snapshot('Winner', false), 0);
  if v <> 1 then raise exception 'Expected first version 1, got %', v; end if;
  begin
    perform public.save_room_snapshot('migration-room', '00000000-0000-4000-8000-000000000001',
      'Stale overwrite', 999, pg_temp.snapshot('Stale overwrite', true), 0);
    raise exception 'Stale version unexpectedly accepted';
  exception when sqlstate 'PT409' then null;
  end;
  if (select name from public.campaigns where id='migration-room') <> 'Winner'
    or (select snapshot->'state'->>'name' from public.room_snapshots where campaign_id='migration-room') <> 'Winner'
    or (select revision from public.room_snapshots where campaign_id='migration-room') <> 5
    or exists(select 1 from public.campaign_members where campaign_id='migration-room'
      and user_id='00000000-0000-4000-8000-000000000002') then
    raise exception 'Stale write partially changed campaign, snapshot or memberships';
  end if;
  -- The former RPC must fail closed for an old process in a rolling deploy.
  begin
    perform public.save_room_snapshot('migration-room', '00000000-0000-4000-8000-000000000001',
      'Legacy overwrite', 999, pg_temp.snapshot('Legacy overwrite', true));
    raise exception 'Legacy RPC unexpectedly accepted';
  exception when sqlstate 'PT409' then null;
  end;
  v := public.save_room_snapshot('migration-room', '00000000-0000-4000-8000-000000000001',
    'Second save', 5, pg_temp.snapshot('Second save', false), 1);
  if v <> 2 then raise exception 'Positive version update failed'; end if;
  begin
    perform public.save_room_snapshot('migration-room', '00000000-0000-4000-8000-000000000003',
      'Wrong owner', 5, pg_temp.snapshot('Wrong owner', false), 2);
    raise exception 'Changed owner unexpectedly accepted';
  exception when sqlstate 'PT409' then null;
  end;
  -- A failed membership insert must roll back the new version and snapshot too.
  begin
    perform public.save_room_snapshot('migration-room', '00000000-0000-4000-8000-000000000001',
      'Bad membership', 5, pg_temp.snapshot('Bad membership', false) ||
        '{"members":{"00000000-0000-4000-8000-000000000001":{"name":"Owner","role":"invalid"}}}'::jsonb, 2);
    raise exception 'Invalid membership unexpectedly accepted';
  exception when check_violation then null;
  end;
  if (select save_version from public.room_snapshots where campaign_id='migration-room') <> 2
    or (select name from public.campaigns where id='migration-room') <> 'Second save'
    or (select snapshot->'state'->>'name' from public.room_snapshots where campaign_id='migration-room') <> 'Second save' then
    raise exception 'Rejected write changed persisted data';
  end if;
  if has_function_privilege('anon','public.save_room_snapshot(text,uuid,text,bigint,jsonb,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.save_room_snapshot(text,uuid,text,bigint,jsonb,bigint)','EXECUTE') then
    raise exception 'Client roles can execute save RPC';
  end if;
  begin
    perform public.save_room_snapshot('missing-room', '00000000-0000-4000-8000-000000000001',
      'Missing room', 1, pg_temp.snapshot('Missing room', true), 9);
    raise exception 'Nonexistent expected version unexpectedly accepted';
  exception when sqlstate 'PT409' then null;
  end;
  if exists(select 1 from public.campaigns where id='missing-room') then
    raise exception 'Failed creation left campaign metadata behind';
  end if;
  v := public.save_room_snapshot('race-room', '00000000-0000-4000-8000-000000000001',
    'Race initial', 1, pg_temp.snapshot('Race initial', true), 0);
  if v <> 1 then raise exception 'New campaign first save failed'; end if;
end $$;
reset role;
