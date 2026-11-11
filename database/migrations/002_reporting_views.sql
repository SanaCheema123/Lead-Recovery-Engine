-- ============================================================================
-- Reporting views — used by the daily health report (workflow 12) and demos.
-- ============================================================================

-- Daily KPIs per client
create or replace view v_daily_kpis as
with days as (
  select c.id as client_id, c.name as client_name, d::date as day
  from clients c
  cross join generate_series(current_date - 29, current_date, interval '1 day') d
)
select
  d.client_id, d.client_name, d.day,
  (select count(distinct m.lead_id) from messages m where m.client_id = d.client_id and m.direction = 'outbound' and m.purpose = 'campaign' and m.created_at::date = d.day) as leads_contacted,
  (select count(*) from messages m where m.client_id = d.client_id and m.direction = 'outbound' and m.created_at::date = d.day) as messages_sent,
  (select count(distinct m.lead_id) from messages m where m.client_id = d.client_id and m.direction = 'inbound' and m.created_at::date = d.day) as leads_replied,
  (select count(*) from events e join leads l on l.id = e.lead_id where l.client_id = d.client_id and e.type = 'status_changed' and e.data->>'to' = 'qualified' and e.created_at::date = d.day) as newly_qualified,
  (select count(*) from appointments a where a.client_id = d.client_id and a.created_at::date = d.day) as appointments_booked,
  (select count(*) from handoffs h join leads l on l.id = h.lead_id where l.client_id = d.client_id and h.created_at::date = d.day) as handoffs,
  (select count(*) from opt_outs o where o.client_id = d.client_id and o.created_at::date = d.day) as opt_outs,
  (select count(*) from messages m where m.client_id = d.client_id and m.direction = 'outbound' and m.status in ('failed','undelivered') and m.created_at::date = d.day) as delivery_failures,
  (select coalesce(sum(t.prompt_tokens),0) from ai_turns t join leads l on l.id = t.lead_id where l.client_id = d.client_id and t.created_at::date = d.day) as prompt_tokens,
  (select coalesce(sum(t.completion_tokens),0) from ai_turns t join leads l on l.id = t.lead_id where l.client_id = d.client_id and t.created_at::date = d.day) as completion_tokens
from days d;

-- Funnel snapshot per client
create or replace view v_funnel as
select
  c.id as client_id, c.name as client_name,
  count(*) filter (where l.status <> 'new')                                         as enrolled,
  count(*) filter (where l.last_outbound_at is not null)                            as contacted,
  count(*) filter (where l.last_inbound_at is not null)                             as replied,
  count(*) filter (where l.status in ('qualifying','qualified','appointment_booked','handed_off')) as engaged_in_qualification,
  count(*) filter (where l.status in ('qualified','appointment_booked'))            as qualified,
  count(*) filter (where l.status = 'appointment_booked')                           as booked,
  count(*) filter (where l.temperature = 'hot')                                     as hot,
  count(*) filter (where l.status = 'nurture')                                      as nurture,
  count(*) filter (where l.status = 'dnc')                                          as dnc,
  round(100.0 * count(*) filter (where l.last_inbound_at is not null)
        / nullif(count(*) filter (where l.last_outbound_at is not null), 0), 1)    as reply_rate_pct,
  round(100.0 * count(*) filter (where l.status = 'appointment_booked')
        / nullif(count(*) filter (where l.last_outbound_at is not null), 0), 2)    as booking_rate_pct
from clients c
left join leads l on l.client_id = c.id
group by c.id, c.name;

-- Things a human should look at
create or replace view v_attention_needed as
select 'unanswered_handoff' as issue, h.lead_id, h.created_at as since, h.reason as detail
from handoffs h where h.resolved_at is null and h.created_at < now() - interval '2 hours'
union all
select 'stuck_enrollment', e.lead_id, e.locked_until, 'locked > 1h'
from campaign_enrollments e where e.locked_until < now() - interval '1 hour' and e.status = 'active'
union all
select 'inbound_without_reply', l.id, l.last_inbound_at, l.status
from leads l
where l.last_inbound_at > coalesce(l.last_outbound_at, 'epoch')
  and l.last_inbound_at < now() - interval '30 minutes'
  and l.ai_paused = false
  and l.status not in ('dnc','wrong_number','bad_number','not_interested','handed_off','appointment_booked');
