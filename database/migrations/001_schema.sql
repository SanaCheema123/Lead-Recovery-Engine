-- ============================================================================
-- Lead Recovery Engine — core schema (PostgreSQL 15+)
-- The engine's own state lives here; the CRM remains the system of record for
-- the client's sales team. n8n stores its own data in a separate database.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- clients
create table if not exists clients (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique not null,
  name             text not null,
  timezone         text not null default 'America/New_York',
  crm_type         text not null check (crm_type in ('ghl', 'hubspot', 'none')),
  calendar_provider text not null default 'ghl' check (calendar_provider in ('ghl', 'calcom', 'none')),
  settings         jsonb not null default '{}'::jsonb,   -- full YAML config (persona, messaging, crm mapping…)
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Inbound SMS is routed to a client by the number it was sent TO.
create table if not exists client_phone_numbers (
  phone_e164  text primary key,
  client_id   uuid not null references clients(id) on delete cascade
);

-- ---------------------------------------------------------------- leads
create table if not exists leads (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references clients(id) on delete cascade,
  crm_contact_id        text,
  first_name            text,
  last_name             text,
  phone_e164            text,
  email                 text,
  property_address      text,
  property_city         text,
  property_state        text,
  property_zip          text,
  timezone              text,
  status                text not null default 'new' check (status in (
                          'new','queued','contacted','engaged','qualifying','qualified','appointment_booked',
                          'handed_off','nurture','not_interested','wrong_number','bad_number','dnc')),
  score                 int not null default 0,
  temperature           text not null default 'cold' check (temperature in ('cold','warm','hot')),
  opted_out             boolean not null default false,
  ai_paused             boolean not null default false,
  assigned_user         text,
  nudge_count           int not null default 0,
  attempt_count         int not null default 0,
  nurture_until         date,
  email_reply_token     text unique not null default encode(gen_random_bytes(12), 'hex'),
  crm_last_activity_at  timestamptz,
  last_inbound_at       timestamptz,
  last_outbound_at      timestamptz,
  source                text not null default 'crm_import',
  source_raw            jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (client_id, crm_contact_id)
);
create index if not exists leads_phone_idx   on leads (phone_e164);
create index if not exists leads_email_idx   on leads (lower(email));
create index if not exists leads_status_idx  on leads (client_id, status);

-- ---------------------------------------------------------------- qualification
create table if not exists qualifications (
  lead_id              uuid primary key references leads(id) on delete cascade,
  is_owner             boolean,
  interested_in_selling text,
  timeline             text,
  motivation_level     text,
  motivation_reasons   text[] not null default '{}',
  property_type        text,
  property_condition   text,
  occupancy            text,
  price_flexibility    text,
  asking_price         numeric,
  is_decision_maker    boolean,
  bedrooms             numeric,
  bathrooms            numeric,
  best_contact_time    text,
  notes                text,
  summary              text,
  score_reasons        text[] not null default '{}',
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------- messages
create table if not exists messages (
  id                   uuid primary key default gen_random_uuid(),
  lead_id              uuid references leads(id) on delete cascade,
  client_id            uuid references clients(id) on delete cascade,
  direction            text not null check (direction in ('inbound','outbound')),
  channel              text not null check (channel in ('sms','email')),
  body                 text,
  subject              text,
  purpose              text,              -- campaign | conversation | nudge | reminder | opt_out_confirmation | handoff_ack
  provider_message_id  text unique,       -- Twilio MessageSid / SendGrid message id (dedupe key)
  status               text,              -- queued | sent | delivered | undelivered | failed | received
  error_code           text,
  from_address         text,
  to_address           text,
  ai_turn_id           uuid,
  campaign_step        int,
  created_at           timestamptz not null default now()
);
create index if not exists messages_lead_idx on messages (lead_id, created_at desc);

-- ---------------------------------------------------------------- AI audit
create table if not exists ai_turns (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid references leads(id) on delete cascade,
  trigger_message_id uuid,
  mode               text,
  model              text,
  prompt_tokens      int,
  completion_tokens  int,
  latency_ms         int,
  raw_output         jsonb,
  decision           jsonb,          -- output of processTurn (action, status, score, issues…)
  action             text,
  guardrail_issues   text[] not null default '{}',
  created_at         timestamptz not null default now()
);
create index if not exists ai_turns_lead_idx on ai_turns (lead_id, created_at desc);

-- ---------------------------------------------------------------- campaigns
create table if not exists campaigns (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  slug        text not null,
  name        text not null,
  status      text not null default 'paused' check (status in ('draft','active','paused','archived')),
  settings    jsonb not null default '{}'::jsonb,   -- stale_days, daily_new_limit, exclude_statuses…
  steps       jsonb not null default '[]'::jsonb,   -- [{key, day, channel, sms, email_subject, email_body}]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (client_id, slug)
);

create table if not exists campaign_enrollments (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references campaigns(id) on delete cascade,
  lead_id        uuid not null references leads(id) on delete cascade,
  step_index     int not null default 0,
  status         text not null default 'active' check (status in ('active','completed','stopped')),
  next_touch_at  timestamptz,
  locked_until   timestamptz,
  stopped_reason text,
  enrolled_at    timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (campaign_id, lead_id)
);
create index if not exists enrollments_due_idx on campaign_enrollments (status, next_touch_at);

-- ---------------------------------------------------------------- appointments
create table if not exists appointments (
  id                   uuid primary key default gen_random_uuid(),
  lead_id              uuid not null references leads(id) on delete cascade,
  client_id            uuid not null references clients(id) on delete cascade,
  provider             text not null,
  provider_event_id    text,
  starts_at            timestamptz not null,
  ends_at              timestamptz,
  status               text not null default 'booked' check (status in ('booked','cancelled','completed','no_show','rescheduled')),
  reminder_24h_sent_at timestamptz,
  reminder_1h_sent_at  timestamptz,
  created_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------- handoffs
create table if not exists handoffs (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  mode        text not null,       -- handoff | forward | booked | unknown_sender | hostile
  reason      text,
  notified    jsonb,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- ---------------------------------------------------------------- suppression
create table if not exists opt_outs (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients(id) on delete cascade,   -- null = global suppression
  channel     text not null check (channel in ('sms','email')),
  value       text not null,      -- E.164 phone or lower-case email
  source      text not null,      -- keyword | natural_language | carrier | email_unsubscribe | manual | crm_dnd
  created_at  timestamptz not null default now(),
  unique (client_id, channel, value)
);

-- ---------------------------------------------------------------- ops
create table if not exists import_state (
  client_id    uuid primary key references clients(id) on delete cascade,
  cursor       text,
  last_run_at  timestamptz,
  last_count   int
);

create table if not exists crm_sync_log (
  id          bigserial primary key,
  lead_id     uuid references leads(id) on delete cascade,
  op          text not null,
  request     jsonb,
  http_status int,
  error       text,
  created_at  timestamptz not null default now()
);

create table if not exists workflow_errors (
  id            bigserial primary key,
  workflow_name text,
  node_name     text,
  execution_id  text,
  message       text,
  signature     text,
  payload       jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists workflow_errors_sig_idx on workflow_errors (signature, created_at desc);

create table if not exists events (
  id         bigserial primary key,
  lead_id    uuid references leads(id) on delete cascade,
  type       text not null,
  data       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_lead_idx on events (lead_id, created_at desc);

-- ============================================================================
-- Triggers
-- ============================================================================

create or replace function lre_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['clients','leads','campaigns','campaign_enrollments'] loop
    execute format('drop trigger if exists trg_%1$s_updated on %1$s; create trigger trg_%1$s_updated before update on %1$s for each row execute function lre_touch_updated_at();', t);
  end loop;
end $$;

-- Suppression guard: a lead whose phone/email is on the opt-out list is ALWAYS dnc,
-- no matter which workflow (or human) tries to change it. Defence in depth.
create or replace function lre_enforce_suppression() returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from opt_outs o
    where (o.client_id is null or o.client_id = new.client_id)
      and ((o.channel = 'sms' and o.value = new.phone_e164) or (o.channel = 'email' and o.value = lower(new.email)))
  ) then
    new.opted_out := true;
    new.status := 'dnc';
  end if;
  return new;
end $$;

drop trigger if exists trg_leads_suppression on leads;
create trigger trg_leads_suppression before insert or update on leads
  for each row execute function lre_enforce_suppression();

-- When a lead becomes dnc / booked / closed, stop all active cadences.
create or replace function lre_stop_enrollments() returns trigger language plpgsql as $$
begin
  if old.status is distinct from new.status then
    insert into events (lead_id, type, data)
    values (new.id, 'status_changed', jsonb_build_object('from', old.status, 'to', new.status, 'score', new.score));
  end if;
  if new.status in ('dnc','wrong_number','bad_number','not_interested','appointment_booked','handed_off')
     and (old.status is distinct from new.status) then
    update campaign_enrollments
       set status = 'stopped', stopped_reason = 'lead_status_' || new.status, locked_until = null
     where lead_id = new.id and status = 'active';
  end if;
  return new;
end $$;

drop trigger if exists trg_leads_stop_enrollments on leads;
create trigger trg_leads_stop_enrollments after update of status on leads
  for each row execute function lre_stop_enrollments();
