-- Uploaded images stay private; only the authenticated backend accesses objects.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tabletop-assets','tabletop-assets',false,10485760,array['image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/webp'];
-- Removing members must also remove their durable metadata access.
create or replace function public.save_room_snapshot(p_id text,p_owner uuid,p_name text,p_revision bigint,p_snapshot jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.campaigns(id,owner_id,name) values(p_id,p_owner,p_name)
    on conflict(id) do update set name=excluded.name;
  insert into public.room_snapshots(campaign_id,revision,snapshot)
    values(p_id,p_revision,p_snapshot)
    on conflict(campaign_id) do update set revision=excluded.revision,snapshot=excluded.snapshot,updated_at=now();
  delete from public.campaign_members where campaign_id=p_id and not (p_snapshot->'members' ? user_id::text);
  insert into public.campaign_members(campaign_id,user_id,display_name,role)
    select p_id,key::uuid,value->>'name',value->>'role' from jsonb_each(p_snapshot->'members')
    on conflict(campaign_id,user_id) do update set display_name=excluded.display_name,role=excluded.role;
end;
$$;
revoke all on function public.save_room_snapshot(text,uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_room_snapshot(text,uuid,text,bigint,jsonb) to service_role;
