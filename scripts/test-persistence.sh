#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Requires an empty disposable PostgreSQL database; PG* env vars select it.
psql -X -v ON_ERROR_STOP=1 -f scripts/test-persistence.sql
logs=$(mktemp -d)
cleanup() {
  exec 3>&- 2>/dev/null || true
  for pid in ${a:-} ${b:-} ${coordinator:-}; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$logs"
}
trap cleanup EXIT
save() {
  local name=$1 player=$2 application=$3
  PGAPPNAME="$application" psql -X -v ON_ERROR_STOP=1 <<SQL
set role service_role;
select public.save_room_snapshot('race-room','00000000-0000-4000-8000-000000000001',
  '$name',1,jsonb_build_object('state',jsonb_build_object('name','$name'),
  'members',jsonb_build_object(
    '00000000-0000-4000-8000-000000000001',jsonb_build_object('name','Owner','role','gm'),
    '$player',jsonb_build_object('name','$name','role','player'))),1);
SQL
}
# Hold the campaign row until both writers are demonstrably blocked on it.
# Merely launching two clients can accidentally test sequential saves instead.
mkfifo "$logs/coordinator-input"
PGAPPNAME=cas-coordinator psql -X -At -v ON_ERROR_STOP=1 <"$logs/coordinator-input" >"$logs/coordinator" 2>&1 & coordinator=$!
exec 3>"$logs/coordinator-input"
printf '%s\n' 'begin;' "select id from public.campaigns where id='race-room' for update;" "select 'ROW_LOCK_HELD';" >&3
locked=0
for attempt in {1..100}; do
  locked=$(psql -X -At -v ON_ERROR_STOP=1 -c "select count(*) from pg_stat_activity where application_name='cas-coordinator' and state='idle in transaction' and query like '%ROW_LOCK_HELD%'")
  [[ "$locked" == 1 ]] && break
  sleep 0.1
done
[[ "$locked" == 1 ]] || { cat "$logs/coordinator"; exit 1; }
save 'Contender A' '00000000-0000-4000-8000-000000000002' cas-writer-a >"$logs/a" 2>&1 & a=$!
save 'Contender B' '00000000-0000-4000-8000-000000000003' cas-writer-b >"$logs/b" 2>&1 & b=$!
waiting=0
for attempt in {1..100}; do
  waiting=$(psql -X -At -v ON_ERROR_STOP=1 -c "select count(*) from pg_stat_activity where application_name in ('cas-writer-a','cas-writer-b') and wait_event_type='Lock'")
  [[ "$waiting" == 2 ]] && break
  sleep 0.1
done
[[ "$waiting" == 2 ]] || { echo 'Both competing saves must wait on the row lock' >&2; cat "$logs/a" "$logs/b"; exit 1; }
printf '%s\n' 'commit;' '\q' >&3
exec 3>&-
wait "$coordinator"
coordinator=
sa=0; wait "$a" || sa=$?
sb=0; wait "$b" || sb=$?
a=; b=
cat "$logs/a" "$logs/b"
if (( (sa == 0) + (sb == 0) != 1 )); then
  echo 'Exactly one concurrent writer must succeed' >&2
  exit 1
fi
if (( sa != 0 )); then grep -q 'Snapshot save version conflict' "$logs/a"; fi
if (( sb != 0 )); then grep -q 'Snapshot save version conflict' "$logs/b"; fi
psql -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare winner text; members jsonb;
begin
  select name into winner from public.campaigns where id='race-room';
  select snapshot->'members' into members from public.room_snapshots where campaign_id='race-room';
  if winner not in ('Contender A','Contender B')
    or (select save_version from public.room_snapshots where campaign_id='race-room') <> 2
    or (select snapshot->'state'->>'name' from public.room_snapshots where campaign_id='race-room') <> winner
    or (select count(*) from public.campaign_members where campaign_id='race-room') <> 2
    or exists(select 1 from public.campaign_members where campaign_id='race-room'
      and (members->user_id::text->>'name' is distinct from display_name
        or members->user_id::text->>'role' is distinct from role)) then
    raise exception 'Concurrent save did not preserve one atomic winner';
  end if;
end $$;
SQL
echo 'PostgreSQL migration, CAS, membership atomicity, legacy fencing and concurrent-writer checks passed.'
