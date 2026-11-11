.PHONY: help up down logs build deploy test test-sql test-scenarios verify sync import-demo backup psql

help:            ## Show commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

up:              ## Start the stack
	docker compose up -d
down:            ## Stop the stack
	docker compose down
logs:            ## Tail n8n logs
	docker compose logs -f --tail=200 n8n n8n-worker
build:           ## Generate n8n workflow JSON from source
	node tools/build-workflows.js
deploy:          ## Build + import credentials & workflows + activate
	bash scripts/deploy-workflows.sh
test:            ## Unit tests (no network)
	node --test tests/unit/*.test.js
test-sql:        ## Validate all workflow SQL + run lifecycle test against DATABASE_URL
	node tools/test-sql.js && node --test tests/integration/*.test.js
test-scenarios:  ## Conversation QA against the real model (needs OPENAI_API_KEY)
	node tools/run-scenarios.js
verify: test build test-sql   ## Everything except live-model scenarios
sync:            ## Load client + campaign YAML into the DB
	node scripts/sync-config.js
import-demo:     ## Load demo leads for the demo client
	node scripts/import-leads-csv.js --client demo-investor --file database/seeds/demo_leads.csv
backup:          ## Dump both databases to ./backups
	bash scripts/backup.sh
psql:            ## Open psql on the LRE database
	docker compose exec postgres psql -U $${POSTGRES_USER:-lre} -d lre
