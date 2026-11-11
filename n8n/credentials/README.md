# n8n Credentials

Workflows reference credentials by **fixed IDs**, so they connect automatically after import.

| ID | Name | n8n type | Used by |
|---|---|---|---|
| `lrePostgres00001` | LRE Postgres | Postgres | all workflows |
| `lreOpenAi0000001` | LRE OpenAI | OpenAI API | 06 AI Conversation Engine |
| `lreTwilio0000001` | LRE Twilio | Twilio API | 03 Outbound Sender |
| `lreSendgrid00001` | LRE SendGrid | Header Auth (`Authorization: Bearer SG…`) | 03, 09 |
| `lreGhl0000000001` | LRE GoHighLevel | Header Auth (`Authorization: Bearer pit-…`) | 01, 14, 15 |
| `lreHubspot000001` | LRE HubSpot | Header Auth (`Authorization: Bearer pat-…`) | 01, 14 |
| `lreCalcom0000001` | LRE Cal.com | Header Auth (`Authorization: Bearer cal_live_…`) | 15 |

`scripts/deploy-workflows.sh` renders `credentials.template.json` with values from `.env` into a temporary file, imports it with the n8n CLI (n8n encrypts it with `N8N_ENCRYPTION_KEY`), and deletes the rendered file.

**Security**
- The rendered file contains secrets: it is git-ignored and removed after import.
- Rotate a secret: update `.env`, re-run `npm run deploy:workflows` (credentials are overwritten by ID).
- Back up `N8N_ENCRYPTION_KEY` in your password manager. Without it, stored credentials can't be decrypted.
- Unused CRMs/calendars can keep placeholder values; their nodes are never reached.

### Required scopes
- **GoHighLevel Private Integration:** contacts.readonly, contacts.write, calendars.readonly, calendars/events.write, opportunities.write, locations.readonly
- **HubSpot Private App:** crm.objects.contacts.read/write, crm.objects.deals.read/write, crm.schemas.contacts.read (+ notes/tasks via contacts write)
- **SendGrid API key:** Mail Send (restricted access)
