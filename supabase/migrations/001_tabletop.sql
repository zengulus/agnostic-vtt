-- Apply in the Supabase SQL editor. Gameplay snapshots are readable ONLY by the backend.
create table public.campaigns (
  id text primary key,
  owner_id uuid not null references auth.users(id),
  name text not null check (length(name) between 1 and 60),
  created_at timestamptz not null default now()
);
create table public.campaign_members (
  campaign_id text not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('gm','player')),
  primary key (campaign_id,user_id)
);
create table public.room_snapshots (
  campaign_id text primary key references public.campaigns(id) on delete cascade,
  revision bigint not null default 0,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.room_snapshots enable row level security;

-- A nonrecursive membership check; the only identity it tests is auth.uid().
create function public.is_campaign_member(p_campaign text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.campaign_members m where m.campaign_id=p_campaign and m.user_id=(select auth.uid()));
$$;
revoke all on function public.is_campaign_member(text) from public,anon;
grant execute on function public.is_campaign_member(text) to authenticated;
create policy member_campaign_read on public.campaigns for select to authenticated
using (owner_id=(select auth.uid()) or public.is_campaign_member(id));
create policy member_membership_read on public.campaign_members for select to authenticated
using (public.is_campaign_member(campaign_id));
-- No client snapshot policies: even authorised players must go through server projection.
revoke all on public.room_snapshots from anon,authenticated;
revoke insert,update,delete on public.campaigns,public.campaign_members from anon,authenticated;
grant select on public.campaigns,public.campaign_members to authenticated;
grant all on public.campaigns,public.campaign_members,public.room_snapshots to service_role;

-- One RPC transaction per snapshot: metadata, membership, and state stay consistent.
create function public.save_room_snapshot(p_id text,p_owner uuid,p_name text,p_revision bigint,p_snapshot jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.campaigns(id,owner_id,name) values(p_id,p_owner,p_name)
    on conflict(id) do update set name=excluded.name;
  insert into public.room_snapshots(campaign_id,revision,snapshot)
    values(p_id,p_revision,p_snapshot)
    on conflict(campaign_id) do update set revision=excluded.revision,snapshot=excluded.snapshot,updated_at=now();
  insert into public.campaign_members(campaign_id,user_id,display_name,role)
    select p_id,key::uuid,value->>'name',value->>'role' from jsonb_each(p_snapshot->'members')
    on conflict(campaign_id,user_id) do update set display_name=excluded.display_name,role=excluded.role;
end;
$$;
revoke all on function public.save_room_snapshot(text,uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_room_snapshot(text,uuid,text,bigint,jsonb) to service_role;
