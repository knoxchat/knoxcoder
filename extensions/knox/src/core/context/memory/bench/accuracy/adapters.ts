/**
 * MEM-79: LongMemEval / LoCoMo / held-out adapters.
 *
 * Datasets are fetched (never vendored). Paths:
 *   KNOX_LONGMEMEVAL_PATH, KNOX_LOCOMO_PATH, KNOX_HELDOUT_PATH
 * Missing files skip that suite. Tests use `SYNTHETIC_ACCURACY_CASES`.
 *
 * Held-out sessions stay local and are anonymized before they enter a number
 * (decision §11.2.4).
 */
import fs from "fs";
import path from "path";

export interface AccuracyMemory {
  title: string;
  content: string;
  keywords?: string;
}

export interface AccuracyCase {
  id: string;
  suite: "longmemeval" | "locomo" | "heldout" | "synthetic";
  question: string;
  answer: string;
  memories: AccuracyMemory[];
}

/** Tiny fixture so tests always run when datasets are not on disk. */
export const SYNTHETIC_ACCURACY_CASES: AccuracyCase[] = [
  {
    id: "syn-auth",
    suite: "synthetic",
    question: "how should login issue tokens",
    answer: "JWT refresh token httpOnly cookie",
    memories: [
      {
        title: "JWT refresh tokens",
        content: "Login issues a short-lived access token and a rotating JWT refresh token in an httpOnly cookie.",
        keywords: "auth, jwt, refresh, cookie",
      },
    ],
  },
  {
    id: "syn-db",
    suite: "synthetic",
    question: "which database do we use",
    answer: "PostgreSQL 15 pgBouncer",
    memories: [
      {
        title: "PostgreSQL primary",
        content: "All services use PostgreSQL 15 with pgBouncer. Max pool size is 20.",
        keywords: "database, postgres, pgbouncer",
      },
    ],
  },
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asLoose(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? { value };
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** LongMemEval: `{ question_id, question, answer, haystack_sessions }`. */
export function normalizeLongMemEval(raw: unknown): AccuracyCase[] {
  const list = Array.isArray(raw) ? raw : asRecord(raw)?.examples ?? asRecord(raw)?.data;
  if (!Array.isArray(list)) return [];
  const out: AccuracyCase[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const question = str(row.question ?? row.query);
    const answer = str(row.answer ?? row.gold);
    if (!question || !answer) continue;
    const sessions = Array.isArray(row.haystack_sessions)
      ? row.haystack_sessions
      : Array.isArray(row.sessions)
        ? row.sessions
        : [];
    const memories: AccuracyMemory[] = [];
    for (const session of sessions) {
      const turns = Array.isArray(session)
        ? session
        : asRecord(session)?.turns ?? asRecord(session)?.messages ?? [];
      if (!Array.isArray(turns)) continue;
      for (const turn of turns) {
        const rec = asLoose(turn);
        const content = str(rec.content ?? rec.text ?? rec.value);
        if (!content.trim()) continue;
        memories.push({
          title: str(rec.role ?? rec.speaker ?? "turn").slice(0, 80),
          content,
        });
      }
    }
    out.push({
      id: str(row.question_id ?? row.id ?? `lme-${out.length}`),
      suite: "longmemeval",
      question,
      answer,
      memories,
    });
  }
  return out;
}

/** LoCoMo: `{ qa: [{ question, answer }], conversation }`. */
export function normalizeLoCoMo(raw: unknown): AccuracyCase[] {
  const root = Array.isArray(raw) ? raw : [raw];
  const out: AccuracyCase[] = [];
  for (const doc of root) {
    const rec = asRecord(doc);
    if (!rec) continue;
    const memories: AccuracyMemory[] = [];
    const convo = asRecord(rec.conversation) ?? rec;
    const turns = Array.isArray(convo.turns)
      ? convo.turns
      : Array.isArray(convo.session)
        ? convo.session
        : Array.isArray(rec.conversation)
          ? rec.conversation
          : [];
    for (const turn of turns) {
      const t = asLoose(turn);
      const content = str(t.text ?? t.content ?? t.utterance);
      if (!content.trim()) continue;
      memories.push({
        title: str(t.speaker ?? t.role ?? "turn").slice(0, 80),
        content,
      });
    }
    const qa = Array.isArray(rec.qa) ? rec.qa : Array.isArray(rec.questions) ? rec.questions : [];
    for (const item of qa) {
      const q = asRecord(item);
      if (!q) continue;
      const question = str(q.question ?? q.query);
      const answer = str(q.answer ?? q.gold);
      if (!question || !answer) continue;
      out.push({
        id: str(q.question_id ?? q.id ?? `locomo-${out.length}`),
        suite: "locomo",
        question,
        answer,
        memories,
      });
    }
  }
  return out;
}

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HOME = /\/(?:Users|home)\/[^\s/]+/gi;

/** Strip emails and home paths before a held-out case enters a published number. */
export function anonymizeHeldOutText(text: string): string {
  return text.replace(EMAIL, "[email]").replace(HOME, "[home]");
}

export function normalizeHeldOut(raw: unknown): AccuracyCase[] {
  const list = Array.isArray(raw) ? raw : asRecord(raw)?.cases ?? asRecord(raw)?.sessions;
  if (!Array.isArray(list)) return [];
  const out: AccuracyCase[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const question = anonymizeHeldOutText(str(row.question ?? row.query));
    const answer = anonymizeHeldOutText(str(row.answer ?? row.gold));
    if (!question || !answer) continue;
    const memoriesRaw = Array.isArray(row.memories) ? row.memories : [];
    out.push({
      id: str(row.id ?? `heldout-${out.length}`),
      suite: "heldout",
      question,
      answer,
      memories: memoriesRaw.map((mem, i) => {
        const rec = asLoose(mem);
        return {
          title: anonymizeHeldOutText(str(rec.title ?? `m${i}`)).slice(0, 80),
          content: anonymizeHeldOutText(str(rec.content ?? rec.text ?? rec.value)),
        };
      }).filter((m) => m.content.trim()),
    });
  }
  return out;
}

export function loadAccuracyCases(env: NodeJS.ProcessEnv = process.env): {
  cases: AccuracyCase[];
  skipped: string[];
} {
  const skipped: string[] = [];
  const cases: AccuracyCase[] = [...SYNTHETIC_ACCURACY_CASES];
  const loaders: Array<{ env: string; name: string; parse: (raw: unknown) => AccuracyCase[] }> = [
    { env: "KNOX_LONGMEMEVAL_PATH", name: "longmemeval", parse: normalizeLongMemEval },
    { env: "KNOX_LOCOMO_PATH", name: "locomo", parse: normalizeLoCoMo },
    { env: "KNOX_HELDOUT_PATH", name: "heldout", parse: normalizeHeldOut },
  ];
  for (const loader of loaders) {
    const file = env[loader.env]?.trim();
    if (!file) {
      skipped.push(`${loader.name}: no ${loader.env}`);
      continue;
    }
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      skipped.push(`${loader.name}: missing ${resolved}`);
      continue;
    }
    try {
      const parsed = loader.parse(readJson(resolved));
      if (parsed.length === 0) skipped.push(`${loader.name}: empty after parse`);
      else cases.push(...parsed);
    } catch (err) {
      skipped.push(`${loader.name}: ${err instanceof Error ? err.message : "parse error"}`);
    }
  }
  return { cases, skipped };
}
