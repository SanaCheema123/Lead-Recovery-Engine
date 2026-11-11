# 05 · CRM Integration

LRE reads contacts from the CRM (workflow 01) and writes results back (07 → 14). The CRM stays the sales team's system of record. LRE never deletes or overwrites the sales team's own fields; it only writes its own `lre_*` fields, tags, notes, tasks and pipeline stages.

> API endpoints and payloads follow GoHighLevel API v2 and HubSpot CRM v3 as designed. Vendors change APIs. Before each client go-live, run the smoke test in `02-setup-guide.md` and check `crm_sync_log` for errors.

## What gets written, and when
| Event | Fields | Tags | Note (with transcript) | Task | Pipeline |
|---|---|---|---|---|---|
| every AI turn | status, score, temperature, timeline, motivation, condition, summary | engaged / qualified / hot / nurture … | – | – | stage if mapped |
| qualified | ✓ | lre-qualified | ✓ | – | → qualified stage |
| hot alert | ✓ | lre-hot | ✓ | "HOT seller lead: call …" | |
| handoff | ✓ | lre-needs-human | ✓ | "Follow up with … (AI handoff)" | |
| appointment booked | ✓ | lre-appointment | ✓ | "Seller call booked" (due at appointment) | → booked stage |
| opted out | ✓ | lre-dnc | ✓ | – | + CRM DND flag |

## GoHighLevel setup
1. **Settings → Private Integrations → Create** with scopes: contacts (read/write), calendars (read) + calendar events (write), opportunities (write), locations (read). Put the token in `.env` as `GHL_PRIVATE_INTEGRATION_TOKEN`.
2. **Location ID**: Settings → Business Profile (or from the URL) → `crm.location_id`.
3. **Custom fields** (Settings → Custom Fields, object Contact), all text unless noted: `LRE Status`, `LRE Score` (number), `LRE Temperature`, `LRE Timeline`, `LRE Motivation`, `LRE Condition`, `LRE Summary` (large text). Copy each field's **ID** into `crm.writeback_fields`.
4. **Pipeline** (optional): create stages such as "AI Qualified" and "Appointment Set". Copy the pipeline and stage IDs into `crm.pipeline`.
5. **Calendar**: create a round-robin or single-user calendar for seller calls. Copy its ID into `calendar.calendar_id`.
6. **Exclude tags**: tag contacts that must never be texted (`lre-exclude`, active deals, etc.). DND contacts are skipped automatically.

## HubSpot setup
1. **Settings → Integrations → Private Apps → Create**, with scopes `crm.objects.contacts.read/write`, `crm.objects.deals.read/write`, `crm.schemas.contacts.read`. Token → `HUBSPOT_PRIVATE_APP_TOKEN`.
2. **Contact properties** (Settings → Properties → Contact): `lre_status`, `lre_score` (number), `lre_temperature`, `lre_timeline`, `lre_motivation`, `lre_condition`, `lre_summary` (multi-line), `lre_tags` (multiple checkboxes with options matching `crm.tags`), `lre_do_not_contact` (single checkbox), `lre_exclude` (single checkbox, set by the team to exclude a contact).
3. In the YAML, `writeback_fields` maps to the **internal property names** (e.g. `lre_status: lre_status`).
4. Pipeline / stages: deal pipeline ID and stage IDs → `crm.pipeline`.
5. Calendar: HubSpot meetings links have no public booking API, so use **Cal.com** (`calendar.provider: calcom`, `calendar_id: <event type id>`).

## Field mapping (import)
`crm.field_map` maps LRE fields to CRM fields. For a GHL custom field, use `cf:<fieldId>`. For example, many investors keep the property address in a custom field rather than the contact address:
```yaml
field_map:
  property_address: "cf:AbC123propertyAddr"
  property_city: "cf:AbC123propertyCity"
```

## Adding another CRM (Salesforce, Podio, REsimpli, InvestorFuse…)
1. `clients.crm_type` check constraint: add the new type (migration `00X_*.sql`).
2. Workflow 01: add a search branch + normalizer that outputs the same lead shape.
3. Workflow 14: add a `Build <CRM> Request` code node that maps the 6 generic ops (`update_fields`, `add_tags`, `set_dnd`, `add_note`, `create_task`, `upsert_opportunity`) to API calls, plus an HTTP node with its credential.
4. Nothing else changes: AI, sender, booking and handoff are CRM-agnostic.

## Multi-tenant (many clients, different CRM accounts, one stack)
v1 uses static n8n credentials (one per CRM type), which suits **one stack per client** or an agency token covering several GHL sub-accounts. For a true SaaS with per-client tokens, store tokens encrypted in a `client_secrets` table (`pgcrypto`), load them in the adapter's Build node, and send `Authorization` from the expression instead of a credential. This is a contained change in workflows 01, 14 and 15.
