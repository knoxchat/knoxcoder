/**
 * Real-world style fixtures for the memory benchmark (P1-7).
 *
 * Unlike `fixtures.ts` (tidy, one topic per memory), these are written the way people
 * actually leave notes: terse, with typos and abbreviations, near-duplicates, a decision
 * that was later superseded, memories that share vocabulary (several about "test" or
 * "deploy"), and a few Chinese entries (the product ships en and zh). Queries are
 * conversational and do not repeat the memory wording.
 *
 * They are hand-written from common coding-agent sessions, not captured from user data
 * (no user memory leaves a machine). Add cases here when a real miss is reported.
 */
import type { BenchMemory, BenchQuery } from "./fixtures";

export const REAL_WORLD_MEMORIES: BenchMemory[] = [
  { key: "rw-node-version", category: "fact", title: "Node 20 only, CI pins 20.11", content: "We run node 20.11 in CI and prod. Dont use node 22 features, the lambda runtime is still 20.", keywords: "node, version, runtime, lambda, ci", importance: 0.8 },
  { key: "rw-pkg-yarn", category: "preference", title: "yarn not npm here", content: "this repo uses yarn berry w/ pnp. npm install breaks the lockfile, always yarn add / yarn workspace x add", keywords: "yarn, npm, pnp, lockfile, install, dependency", importance: 0.8 },
  { key: "rw-env-local", category: "fact", title: "Local dev needs docker compose up first", content: "Postgres and localstack run in docker compose. Run `docker compose up -d` before yarn dev or the api crashes on boot.", keywords: "docker, compose, local, dev, postgres, localstack, boot", importance: 0.7 },
  { key: "rw-flaky-e2e", category: "fact", title: "checkout e2e test is flaky on CI", content: "playwright checkout spec fails ~1 in 8 runs, timing on the payment iframe. Re-run once before debugging, ticket PAY-212.", keywords: "e2e, playwright, flaky, checkout, test, ci, retry", importance: 0.6 },
  { key: "rw-unit-jest", category: "preference", title: "Backend tests: jest with ts-jest", content: "Backend uses jest + ts-jest, tests in __tests__. Frontend is vitest. Dont mix them up.", keywords: "jest, ts-jest, vitest, tests, backend, frontend", importance: 0.7 },
  { key: "rw-money", category: "decision", title: "Money is integer cents, never floats", content: "All amounts are stored and passed as integer cents (int64). Convert to decimal only at the UI edge. A float rounding bug cost us in March.", keywords: "money, currency, cents, integer, float, rounding, price", importance: 0.9 },
  { key: "rw-auth-old", category: "decision", title: "Sessions use server side cookies (superseded)", content: "Old decision: server side sessions in Redis. Replaced by JWT in Q2, only legacy admin app still uses it.", keywords: "session, cookie, redis, legacy, admin, auth", importance: 0.3 },
  { key: "rw-auth-new", category: "decision", title: "New services authenticate with OIDC via Auth0", content: "All new services validate Auth0 OIDC access tokens. Scopes are checked in the gateway middleware, not in handlers.", keywords: "auth0, oidc, token, scope, gateway, middleware, authentication", importance: 0.9 },
  { key: "rw-deploy-friday", category: "preference", title: "No production deploys on Friday", content: "Team rule: freeze prod deploys after Thursday 4pm. Hotfixes need on-call approval in #releases.", keywords: "deploy, production, friday, freeze, hotfix, release", importance: 0.65 },
  { key: "rw-deploy-preview", category: "fact", title: "PR preview environments on Vercel", content: "Every PR gets a Vercel preview for the web app. The api has no previews, use the shared staging.", keywords: "preview, vercel, pr, staging, web, deploy", importance: 0.5 },
  { key: "rw-feature-naming", category: "preference", title: "DB columns snake_case, TS props camelCase", content: "Postgres columns are snake_case. The ORM maps to camelCase. Dont hand-write mapping code.", keywords: "naming, snake_case, camelcase, orm, columns, convention", importance: 0.6 },
  { key: "rw-orm", category: "decision", title: "Prisma is the ORM, no raw SQL in handlers", content: "Use Prisma client. Raw SQL only in db/queries/*.sql through $queryRaw and needs review from the data team.", keywords: "prisma, orm, sql, query, database, raw", importance: 0.8 },
  { key: "rw-pii", category: "fact", title: "PII must never be logged", content: "Emails, phone numbers and card data are PII. Mask with maskPii() before logging. Sentry scrubbing is on but dont rely on it.", keywords: "pii, privacy, logging, mask, sentry, gdpr, email", importance: 0.9 },
  { key: "rw-gh-review", category: "preference", title: "Small PRs, one reviewer from CODEOWNERS", content: "Keep PRs under 400 lines. CODEOWNERS auto-requests review. Squash merge only.", keywords: "pr, review, codeowners, merge, squash, size", importance: 0.55 },
  { key: "rw-ui-lib", category: "fact", title: "UI uses our design system @acme/ui", content: "Dont import MUI or raw tailwind colors. Use @acme/ui components and tokens. Storybook runs on port 6006.", keywords: "ui, design system, components, tokens, storybook, tailwind", importance: 0.65 },
  { key: "rw-a11y", category: "preference", title: "Every interactive element needs a label", content: "a11y lint is blocking in CI. Buttons need accessible names, images alt text, modals trap focus.", keywords: "a11y, accessibility, aria, label, lint, focus", importance: 0.6 },
  { key: "rw-zh-reply", category: "preference", title: "回复请用中文", content: "和我交流时用中文回答，代码和注释保持英文。", keywords: "中文, 回复, 语言, 注释", importance: 0.8 },
  { key: "rw-zh-db", category: "decision", title: "数据库迁移必须可回滚", content: "每个迁移都要写 down 脚本，生产环境先在预发布环境演练一次再上线。", keywords: "数据库, 迁移, 回滚, 预发布, 上线", importance: 0.85 },
  { key: "rw-queue", category: "fact", title: "Background jobs run on BullMQ", content: "Emails, report exports and webhooks retries go through BullMQ on the shared Redis. Jobs must be idempotent.", keywords: "bullmq, queue, job, worker, redis, idempotent, webhook", importance: 0.7 },
  { key: "rw-timezone", category: "decision", title: "Store UTC, convert in the client", content: "Timestamps are UTC ISO strings in the db and api. The browser formats using the user's timezone from their profile.", keywords: "timezone, utc, date, time, timestamp, format", importance: 0.7 },
  { key: "rw-perf-n1", category: "fact", title: "Watch for N+1 in the orders list", content: "orders list endpoint had an N+1 on line items. Use include/select, check with the query log in dev.", keywords: "n+1, performance, orders, prisma, include, query", importance: 0.55 },
  { key: "rw-license", category: "fact", title: "Only MIT/Apache/BSD deps allowed", content: "Legal blocks GPL and AGPL dependencies. license-checker runs in CI.", keywords: "license, gpl, dependency, legal, mit, apache", importance: 0.6 },
];

export const REAL_WORLD_QUERIES: BenchQuery[] = [
  { id: "rw-q-install", message: "add lodash-es to the billing package", expected: ["rw-pkg-yarn"] },
  { id: "rw-q-boot", message: "yarn dev crashes right away with a connection refused to the db", expected: ["rw-env-local"] },
  { id: "rw-q-flaky", message: "the checkout playwright spec just failed again in CI, is that a real regression?", expected: ["rw-flaky-e2e"] },
  { id: "rw-q-money", message: "calculate the invoice total with tax and discount", expected: ["rw-money"] },
  { id: "rw-q-auth", message: "protect the new reports service so only users with the reports scope can call it", expected: ["rw-auth-new"] },
  { id: "rw-q-friday", message: "can I ship this fix to prod now? it's Friday afternoon", expected: ["rw-deploy-friday"] },
  { id: "rw-q-sql", message: "I need a custom aggregate query for the dashboard", expected: ["rw-orm"] },
  { id: "rw-q-log", message: "log the user's email when signup fails so we can debug", expected: ["rw-pii"] },
  { id: "rw-q-button", message: "build an icon-only close button for the dialog", expected: ["rw-a11y"] },
  { id: "rw-q-ui", message: "create a settings card with a toggle", expected: ["rw-ui-lib"] },
  { id: "rw-q-zh-migrate", message: "我要给用户表加一个字段，迁移怎么写", expected: ["rw-zh-db"] },
  { id: "rw-q-job", message: "send the weekly report email in the background and retry on failure", expected: ["rw-queue"] },
  { id: "rw-q-date", message: "show the order creation time to the customer", expected: ["rw-timezone"] },
  { id: "rw-q-license", message: "can we pull in this GPL licensed pdf library", expected: ["rw-license"] },
  { id: "rw-q-multi", message: "write a handler that saves a price from the checkout form and logs the buyer's phone number", expected: ["rw-money", "rw-pii"] },
  { id: "rw-q-none-1", message: "explain the difference between a mutex and a semaphore", expected: [] },
  { id: "rw-q-none-2", message: "rename the variable tmp to result in this function", expected: [] },
  { id: "rw-q-none-3", message: "what does this regex do: ^\\d{3}-\\d{4}$", expected: [] },
  { id: "rw-q-none-4", message: "thanks, that looks good", expected: [] },
];
