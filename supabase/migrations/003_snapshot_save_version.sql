-- Apply during the drained-server rollout described in docs/DURABILITY.md.
-- Keep gameplay revision separate: membership, asset and configuration saves
-- advance this counter even if no gameplay action has occurred.
begin;
alter table public.room_snapshots
  add column if not exists save_version bigint not null default 0
  check (save_version >= 0);

-- Fail closed for old binaries during an accidental mixed-version rollout.
-- Keeping this overload gives a deliberate error instead of a missing-RPC error.
create or replace function public.save_room_snapshot(p_id text,p_owner uuid,p_name text,p_revision bigint,p_snapshot jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = 'PT409', message = 'Snapshot save version required; upgrade the table server.';
end;
$$;
revoke all on function public.save_room_snapshot(text,uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_room_snapshot(text,uuid,text,bigint,jsonb) to service_role;

create or replace function public.save_room_snapshot(
  p_id text,p_owner uuid,p_name text,p_revision bigint,p_snapshot jsonb,p_expected_save_version bigint
) returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  next_version bigint;
begin
  if p_expected_save_version < 0 then
    raise exception using errcode = 'PT409', message = 'Invalid snapshot save version.';
  end if;
  insert into public.campaigns(id,owner_id,name) values(p_id,p_owner,p_name)
    on conflict(id) do update set name=excluded.name
    where public.campaigns.owner_id=excluded.owner_id;
  if not found then
    raise exception using errcode = 'PT409', message = 'Campaign owner changed.';
  end if;
  insert into public.room_snapshots(campaign_id,revision,snapshot,save_version)
    select p_id,p_revision,p_snapshot,1 where p_expected_save_version=0
    on conflict(campaign_id) do update
      set revision=excluded.revision,snapshot=excluded.snapshot,
          save_version=public.room_snapshots.save_version+1,updated_at=now()
      where public.room_snapshots.save_version=p_expected_save_version
    returning save_version into next_version;
  -- Existing snapshots with a positive version take the conditional update path.
  if next_version is null and p_expected_save_version > 0 then
    update public.room_snapshots
      set revision=p_revision,snapshot=p_snapshot,save_version=save_version+1,updated_at=now()
      where campaign_id=p_id and save_version=p_expected_save_version
      returning save_version into next_version;
  end if;
  if next_version is null then
    raise exception using errcode = 'PT409', message = 'Snapshot save version conflict.';
  end if;
  delete from public.campaign_members
    where campaign_id=p_id and not (p_snapshot->'members' ? user_id::text);
  insert into public.campaign_members(campaign_id,user_id,display_name,role)
    select p_id,key::uuid,value->>'name',value->>'role' from jsonb_each(p_snapshot->'members')
    on conflict(campaign_id,user_id) do update set display_name=excluded.display_name,role=excluded.role;
  return next_version;
end;
$$;
revoke all on function public.save_room_snapshot(text,uuid,text,bigint,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.save_room_snapshot(text,uuid,text,bigint,jsonb,bigint) to service_role;
-- Make the new RPC overload and save_version column visible to PostgREST.
notify pgrst, 'reload schema';
commit;
