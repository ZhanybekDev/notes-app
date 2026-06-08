.PHONY: help up down logs build test test-backend test-frontend lint lint-backend lint-frontend migrate seed remind-once login-demo openapi-dump clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "Usage: make <target>\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

up: ## Start the stack (db + backend + bot + frontend)
	@if [ ! -f backend/.env ]; then \
		secret=$$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n'); \
		while IFS= read -r line; do \
			case "$$line" in \
				JWT_SECRET=*) printf 'JWT_SECRET=%s\n' "$$secret" ;; \
				*) printf '%s\n' "$$line" ;; \
			esac; \
		done < backend/.env.example > backend/.env; \
	fi
	docker compose up -d --build

down: ## Stop the stack
	docker compose down

logs: ## Tail all logs
	docker compose logs -f

build: ## Rebuild images
	docker compose build

migrate: ## Run alembic migrations
	docker compose exec backend alembic upgrade head

seed: ## Create demo user + sample notes (username: demo, password: demo1234)
	@printf '%s\n' 'Ensuring database migrations are applied before seeding demo data...'
	docker compose exec backend alembic upgrade head
	docker compose exec backend python -m scripts.seed

remind-once: ## Run one reminder delivery pass in the bot container
	docker compose exec bot python -m app.bot_worker send-due-once

login-demo: ## Print a curl command to log in as the demo user
	@echo "curl -s -X POST http://localhost:8000/api/auth/login -d 'username=demo&password=demo1234' -H 'Content-Type: application/x-www-form-urlencoded'"

test: test-backend test-frontend ## Run all tests

test-backend: ## Run backend tests with coverage
	docker compose exec backend pytest

test-frontend: ## Run frontend tests
	docker compose exec frontend npm run test

lint: lint-backend lint-frontend ## Run all linters

lint-backend: ## Ruff check + format check
	docker compose exec backend ruff check .
	docker compose exec backend ruff format --check .

lint-frontend: ## ESLint
	docker compose exec frontend npm run lint

openapi-dump: ## Regenerate backend/openapi.json from the running backend
	docker compose exec -T backend python -m scripts.dump_openapi > backend/openapi.json

clean: ## Stop and wipe database volume
	docker compose down -v
