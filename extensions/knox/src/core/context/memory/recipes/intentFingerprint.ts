/**
 * Intent fingerprint (MC-20): a stable, order-independent key for "what the
 * user asked for", so the same request phrased differently (or in Chinese)
 * maps to the same recipe lookup.
 *
 * Pure and deterministic. Properties (covered by tests, relied on by MC-81):
 *  - idempotent: fingerprint(fingerprint(x)) === fingerprint(x)
 *  - stable under case, whitespace, punctuation and token order
 *  - paths, URLs and numbers become `$path`, `$url`, `$num` placeholders
 *  - secrets are redacted before anything is derived
 */

import { redactSecrets } from "../../../util/redactSecrets.js";
import { isCjkHeavy } from "../../../jev/cjk.js";

const MAX_TOKENS = 24;

const EN_STOPWORDS = new Set([
  "a", "an", "the", "please", "pls", "can", "could", "would", "will", "you", "i", "me", "my", "we", "us", "our",
  "want", "wanna", "need", "like", "to", "of", "for", "in", "on", "into", "with", "and", "or", "then", "also",
  "just", "now", "so", "it", "this", "that", "some", "new", "called", "named", "is", "be", "do", "help",
  "should", "let", "lets", "s", "there", "here",
]);

/** Canonical verb/noun per synonym. Canonical forms map to themselves. */
const EN_SYNONYMS: Record<string, string> = {
  add: "create", make: "create", build: "create", generate: "create", write: "create", scaffold: "create",
  new: "create", implement: "create", created: "create", creating: "create",
  remove: "delete", drop: "delete", erase: "delete", deleted: "delete",
  rename: "rename", renamed: "rename",
  fix: "fix", repair: "fix", resolve: "fix", patch: "fix", fixed: "fix",
  change: "update", modify: "update", edit: "update", updated: "update", refactor: "refactor",
  components: "component", hooks: "hook", tests: "test", functions: "function", classes: "class",
  pages: "page", routes: "route", endpoints: "endpoint", services: "service", modules: "module",
  buttons: "button", forms: "form", types: "type", files: "file", packages: "package",
  unittest: "test", spec: "test", specs: "test",
  install: "install", dependency: "package", dependencies: "package", library: "package", lib: "package",
};

/** Ordered longest-first: multi-char CJK phrases that map to canonical English tokens, or "" to drop. */
const ZH_TERMS: [string, string][] = [
  ["帮我", ""], ["请你", ""], ["麻烦", ""], ["一下", ""], ["我想", ""], ["我要", ""], ["需要", ""], ["请", ""],
  ["一个", ""], ["这个", ""], ["那个", ""], ["新的", ""], ["叫做", ""], ["名为", ""], ["叫", ""], ["的", ""],
  ["吧", ""], ["吗", ""], ["了", ""], ["把", ""], ["给", ""], ["个", ""], ["并", ""], ["再", ""],
  ["创建", " create "], ["新建", " create "], ["添加", " create "], ["增加", " create "], ["生成", " create "],
  ["编写", " create "], ["写", " create "], ["做", " create "], ["实现", " create "],
  ["删除", " delete "], ["移除", " delete "], ["去掉", " delete "],
  ["重命名", " rename "], ["修复", " fix "], ["修正", " fix "], ["修改", " update "], ["更新", " update "],
  ["更改", " update "], ["重构", " refactor "], ["安装", " install "],
  ["组件", " component "], ["按钮", " button "], ["表单", " form "], ["页面", " page "], ["路由", " route "],
  ["接口", " endpoint "], ["服务", " service "], ["模块", " module "], ["函数", " function "], ["测试", " test "],
  ["单元测试", " test "], ["类型", " type "], ["文件", " file "], ["依赖", " package "], ["钩子", " hook "],
];
const ZH_SORTED = [...ZH_TERMS].sort((a, b) => b[0].length - a[0].length);

const URL_RE = /\bhttps?:\/\/[^\s)]+/g;
const PATH_RE = /(?:[\w.@~-]+\/)+[\w.@-]+|\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|json|ya?ml|toml|md|css|scss|html|py|rs|go|java|kt|swift|rb|php|c|h|cpp|sh|sql|vue|svelte)\b/g;
const NUM_RE = /(?<![\w$])\d+(?:\.\d+)?(?![\w])/g;
const TOKEN_RE = /\$[a-z]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[a-z0-9_]+/gu;

export interface IntentFingerprint {
  /** Space-joined sorted unique tokens; the lookup key. */
  key: string;
  tokens: string[];
}

function replaceZh(text: string): string {
  let out = text;
  for (const [from, to] of ZH_SORTED) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

export function computeIntentFingerprint(message: string): IntentFingerprint {
  let text = redactSecrets(String(message ?? "")).normalize("NFKC").toLowerCase();
  text = text.replace(URL_RE, " $url ").replace(PATH_RE, " $path ").replace(NUM_RE, " $num ");
  // Keep `$` only for our own placeholders.
  text = text.replace(/\$(?!url\b|path\b|num\b)/g, " ");
  if (isCjkHeavy(text, 0.15) || /[\u3400-\u9fff]/.test(text)) text = replaceZh(text);

  const seen = new Set<string>();
  for (const raw of text.match(TOKEN_RE) ?? []) {
    if (raw.startsWith("$")) {
      seen.add(raw);
      continue;
    }
    if (EN_STOPWORDS.has(raw)) continue;
    const token = EN_SYNONYMS[raw] ?? raw;
    if (token.length === 0) continue;
    if (/^[a-z0-9_]$/.test(token) && !/^\d$/.test(token)) continue; // lone letters carry no intent
    seen.add(token);
  }
  const tokens = [...seen].sort().slice(0, MAX_TOKENS);
  return { key: tokens.join(" "), tokens };
}

export function intentFingerprint(message: string): string {
  return computeIntentFingerprint(message).key;
}

/** Jaccard overlap of two fingerprints' tokens, 0..1. Used by the matcher (MC-21). */
export function fingerprintSimilarity(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter(Boolean));
  const sb = new Set(b.split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}
