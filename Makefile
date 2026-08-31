.PHONY: up down logs migrate seed deploy backup

COMPOSE_DEV := docker compose
COMPOSE_PROD := docker compose --env-file .env.production -f docker-compose.prod.yml

up:
	$(COMPOSE_DEV) up -d

down:
	$(COMPOSE_DEV) down

logs:
	$(COMPOSE_DEV) logs -f --tail=100

migrate:
	pnpm db:migrate

seed:
	pnpm db:seed

deploy:
	./deploy/deploy.sh

backup:
	./deploy/backup.sh
