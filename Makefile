.DEFAULT_GOAL := help
.PHONY: help install dev build preview check test test-watch verify ci purge-cache deploy deploy-prod push design-system clean clean-all

PORT ?= 4321
HOST ?= localhost
BRANCH ?= main
MSG ?= chore: update OpsMask build and assets

help: ## Show available make targets
	@echo "OpsMask — Build & Development Commands"
	@echo ""
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install npm dependencies
	npm install

dev: ## Start local Astro development server (PORT=4321)
	npm run dev -- --port $(PORT) --host $(HOST)

build: ## Build production static site into dist/
	npm run build

preview: ## Preview the built static site locally
	npm run preview -- --port $(PORT) --host $(HOST)

check: ## Run Astro and TypeScript diagnostics
	npm run check

test: ## Run all Vitest unit tests once
	npm test

test-watch: ## Run Vitest in interactive watch mode
	npm run test:watch

verify: test check build ## Run full verification suite (test + check + build)

ci: ## Clean install and run full verification pipeline
	npm ci
	$(MAKE) verify

purge-cache: ## Purge Cloudflare Zone CDN edge cache (purge_everything)
	node scripts/purge-cache.mjs

deploy: build ## Build, deploy to Cloudflare Workers (opsmask-com), and purge CDN cache
	npx wrangler deploy
	node scripts/purge-cache.mjs

deploy-prod: deploy ## Alias for make deploy (deploy to production Worker opsmask-com)

push: build ## Build latest dist/, commit all changes, and push to GitHub (custom MSG="...")
	git add -A
	git diff --cached --quiet || git commit -m "$(MSG)"
	git push origin $(BRANCH)

design-system: ## Regenerate UI/UX Pro Max design system tokens
	python3 .agents/skills/ui-ux-pro-max/scripts/search.py "developer tool devops cybersecurity" --design-system --variance 6 --motion 5 --density 8 --persist -p "OpsMask" --output-dir "."

clean: ## Remove build and cache artifacts (dist/ and .astro/)
	rm -rf dist .astro

clean-all: clean ## Remove build artifacts and node_modules/
	rm -rf node_modules
