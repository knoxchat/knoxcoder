/**
 * K-035 benchmark fixtures: a small project memory and queries with known answers.
 *
 * `key` is stable; the benchmark matches injected items by title. Queries are
 * worded differently from the memory text on purpose, so this measures retrieval
 * and not string equality. `expected` empty means "nothing here should be
 * injected" (topic-switch and unrelated queries).
 */

export interface BenchMemory {
  key: string;
  category: "fact" | "decision" | "preference";
  title: string;
  content: string;
  keywords: string;
  importance: number;
}

export interface BenchQuery {
  id: string;
  message: string;
  /** Keys of memories that should be injected. Empty = should inject none. */
  expected: string[];
}

export const BENCH_MEMORIES: BenchMemory[] = [
  { key: "auth-jwt", category: "decision", title: "Use JWT refresh tokens for sessions", content: "Login issues a short-lived access token and a rotating refresh token stored in an httpOnly cookie.", keywords: "auth, jwt, refresh, token, login, session, cookie", importance: 0.9 },
  { key: "db-postgres", category: "decision", title: "PostgreSQL is the primary database", content: "All services use PostgreSQL 15 with pgBouncer. Max pool size is 20 connections.", keywords: "database, postgres, postgresql, pgbouncer, pool", importance: 0.85 },
  { key: "migrations", category: "fact", title: "Database migrations use Flyway", content: "Migrations live in db/migrations and are named V<number>__description.sql. Never edit an applied migration.", keywords: "migration, flyway, schema, sql", importance: 0.8 },
  { key: "ci-github", category: "fact", title: "CI runs on GitHub Actions", content: "The workflow in .github/workflows/ci.yml runs lint, unit tests and the integration suite on every pull request.", keywords: "ci, github, actions, workflow, pipeline, pull request", importance: 0.7 },
  { key: "test-vitest", category: "preference", title: "Write unit tests with vitest", content: "Prefer vitest over jest. Test files sit next to the source as name.test.ts.", keywords: "test, vitest, jest, unit, spec", importance: 0.75 },
  { key: "style-tabs", category: "preference", title: "Code style uses tabs and single quotes", content: "Formatting is enforced by prettier with tabs, single quotes and no semicolons in scripts.", keywords: "style, prettier, format, tabs, quotes, lint", importance: 0.6 },
  { key: "api-rest", category: "decision", title: "Public API is REST with OpenAPI", content: "Endpoints are versioned under /v1 and documented in openapi.yaml. Errors use RFC 7807 problem details.", keywords: "api, rest, openapi, endpoint, errors, versioning", importance: 0.8 },
  { key: "cache-redis", category: "fact", title: "Redis caches hot reads", content: "Product listings are cached in Redis for 60 seconds. Invalidate on write through the cache service.", keywords: "cache, redis, ttl, invalidate, listings", importance: 0.7 },
  { key: "deploy-k8s", category: "fact", title: "Deploys go to Kubernetes via Helm", content: "Helm charts are in deploy/helm. Staging deploys on merge to main, production needs a manual approval.", keywords: "deploy, kubernetes, helm, staging, production, release", importance: 0.75 },
  { key: "logging-json", category: "fact", title: "Structured JSON logging", content: "Use the shared logger. Every log line is JSON with requestId, level and message. Do not use console.log.", keywords: "logging, logger, json, requestid, observability", importance: 0.65 },
  { key: "errors-result", category: "fact", title: "Return Result types instead of throwing", content: "Domain functions return Result<T, E>. Only the HTTP layer converts errors to status codes.", keywords: "errors, result, exceptions, domain, handling", importance: 0.7 },
  { key: "frontend-react", category: "fact", title: "Frontend is React with TanStack Query", content: "Server state goes through TanStack Query. Local UI state stays in component state or Zustand.", keywords: "frontend, react, tanstack, query, state, zustand", importance: 0.7 },
  { key: "i18n-keys", category: "fact", title: "Translations live in locales/*.json", content: "Add every user-facing string to locales/en.json first. Keys are dot separated, for example checkout.total.", keywords: "i18n, translation, locale, strings, keys", importance: 0.55 },
  { key: "perf-budget", category: "decision", title: "Page load budget is 2 seconds", content: "Largest contentful paint must stay under 2 seconds on a mid range phone. Bundle size alerts at 250 KB.", keywords: "performance, budget, lcp, bundle, size, speed", importance: 0.65 },
  { key: "security-secrets", category: "decision", title: "Secrets come from Vault, never from the repo", content: "Runtime secrets are read from HashiCorp Vault. .env files are for local development only and are git ignored.", keywords: "security, secrets, vault, env, credentials", importance: 0.9 },
  { key: "rate-limit", category: "fact", title: "API rate limit is 100 requests per minute", content: "The gateway applies a token bucket per API key. Exceeding it returns HTTP 429 with a Retry-After header.", keywords: "rate, limit, throttle, 429, gateway, bucket", importance: 0.7 },
  { key: "branching", category: "preference", title: "Trunk based development with short branches", content: "Branch from main, keep branches under two days, squash merge with a conventional commit title.", keywords: "git, branch, merge, commit, trunk, squash", importance: 0.6 },
  { key: "monorepo-pnpm", category: "fact", title: "Monorepo managed with pnpm workspaces", content: "Packages live under packages/*. Run scripts with pnpm --filter <name>. Do not use npm install.", keywords: "monorepo, pnpm, workspace, packages, install", importance: 0.75 },
  { key: "email-provider", category: "fact", title: "Transactional email goes through SES", content: "Templates are in emails/ and rendered with MJML. Sending is queued, never inline in a request.", keywords: "email, ses, template, mjml, queue, notification", importance: 0.5 },
  { key: "feature-flags", category: "fact", title: "Feature flags via LaunchDarkly", content: "New behaviour ships behind a flag named feature.<area>.<name> and is removed within two releases.", keywords: "feature, flag, launchdarkly, rollout, toggle", importance: 0.6 },
];

export const BENCH_QUERIES: BenchQuery[] = [
  { id: "q-auth", message: "how should login and token refresh work for a user session", expected: ["auth-jwt"] },
  { id: "q-db", message: "which database and connection pool settings do we use", expected: ["db-postgres"] },
  { id: "q-migration", message: "I need to change a table schema, how do we run migrations", expected: ["migrations"] },
  { id: "q-ci", message: "what does the pull request pipeline check before merge", expected: ["ci-github"] },
  { id: "q-test", message: "add unit tests for the new parser, which test framework", expected: ["test-vitest"] },
  { id: "q-api", message: "design a new endpoint and document the errors it returns", expected: ["api-rest"] },
  { id: "q-cache", message: "product listings are slow, can we cache reads", expected: ["cache-redis"] },
  { id: "q-deploy", message: "how do we release to production on kubernetes", expected: ["deploy-k8s"] },
  { id: "q-log", message: "add logging to the request handler without console output", expected: ["logging-json"] },
  { id: "q-secrets", message: "where should I put the API credentials for the payment provider", expected: ["security-secrets"] },
  { id: "q-throttle", message: "clients are getting 429 responses, what is the throttle limit", expected: ["rate-limit"] },
  { id: "q-pnpm", message: "install a dependency in one workspace package", expected: ["monorepo-pnpm"] },
  { id: "q-multi", message: "implement the checkout endpoint with token auth and database writes", expected: ["auth-jwt", "db-postgres", "api-rest"] },
  { id: "q-none-1", message: "what is the capital of France", expected: [] },
  { id: "q-none-2", message: "write a haiku about autumn", expected: [] },
  { id: "q-none-3", message: "convert this temperature from celsius to fahrenheit", expected: [] },
];
