/**
 * Intent fingerprint (MC-20): a stable, order-independent key for "what the
 * user asked for", so the same request phrased differently (or in Chinese /
 * Japanese / Korean) maps to the same recipe lookup.
 *
 * Pure and deterministic. Properties (covered by tests, relied on by MC-81):
 *  - idempotent: fingerprint(fingerprint(x)) === fingerprint(x)
 *  - stable under case, whitespace, punctuation and token order
 *  - paths, URLs and numbers become `$path`, `$url`, `$num` placeholders
 *  - secrets are redacted before anything is derived
 */

import { redactSecrets } from "../../../util/redactSecrets.js";

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
  setup: "create", bootstrap: "create", introduce: "create", compose: "create",
  remove: "delete", drop: "delete", erase: "delete", deleted: "delete", uninstall: "delete", purge: "delete",
  rename: "rename", renamed: "rename",
  fix: "fix", repair: "fix", resolve: "fix", patch: "fix", fixed: "fix", debug: "fix", correct: "fix",
  change: "update", modify: "update", edit: "update", updated: "update", tweak: "update", adjust: "update",
  alter: "update", refactor: "refactor",
  components: "component", hooks: "hook", tests: "test", functions: "function", classes: "class",
  pages: "page", routes: "route", endpoints: "endpoint", services: "service", modules: "module",
  buttons: "button", forms: "form", types: "type", files: "file", packages: "package",
  unittest: "test", spec: "test", specs: "test", testcase: "test", testcases: "test",
  install: "install", dependency: "package", dependencies: "package", library: "package", lib: "package",
  lint: "lint", linter: "lint", eslint: "lint",
  prettier: "format", format: "format", formatting: "format", fmt: "format",
  config: "config", configuration: "config", conf: "config",
  util: "util", utility: "util", helper: "util", utils: "util",
  script: "script", scripts: "script",
  login: "login", signin: "login",
};

/** Ordered longest-first: multi-char CJK phrases that map to canonical English tokens, or "" to drop. */
const CJK_TERMS: [string, string][] = [
  // ZH particles / politeness
  ["帮我", ""], ["请你", ""], ["麻烦", ""], ["一下", ""], ["我想", ""], ["我要", ""], ["需要", ""], ["请", ""],
  ["一个", ""], ["这个", ""], ["那个", ""], ["新的", ""], ["叫做", ""], ["名为", ""], ["叫", ""], ["的", ""],
  ["吧", ""], ["吗", ""], ["了", ""], ["把", ""], ["给", ""], ["个", ""], ["并", ""], ["再", ""],
  ["单元测试", " test "], ["重命名", " rename "],
  ["创建", " create "], ["新建", " create "], ["添加", " create "], ["增加", " create "], ["生成", " create "],
  ["编写", " create "], ["写", " create "], ["做", " create "], ["实现", " create "],
  ["删除", " delete "], ["移除", " delete "], ["去掉", " delete "],
  ["修复", " fix "], ["修正", " fix "], ["调试", " fix "], ["修改", " update "], ["更新", " update "],
  ["更改", " update "], ["重构", " refactor "], ["安装", " install "], ["格式化", " format "],
  ["组件", " component "], ["按钮", " button "], ["表单", " form "], ["页面", " page "], ["路由", " route "],
  ["接口", " endpoint "], ["服务", " service "], ["模块", " module "], ["函数", " function "], ["测试", " test "],
  ["类型", " type "], ["文件", " file "], ["依赖", " package "], ["钩子", " hook "],
  ["配置", " config "], ["脚本", " script "], ["登录", " login "], ["登入", " login "],
  // JP
  ["してください", ""], ["ください", ""], ["お願い", ""],
  ["を", ""], ["に", ""], ["は", ""], ["が", ""], ["で", ""], ["と", ""], ["の", ""], ["も", ""], ["へ", ""],
  ["コンポーネント", " component "], ["インストール", " install "], ["パッケージ", " package "],
  ["作成", " create "], ["作って", " create "], ["作る", " create "], ["追加", " create "],
  ["削除", " delete "], ["除去", " delete "],
  ["修正", " fix "], ["直して", " fix "], ["更新", " update "], ["変更", " update "],
  ["ボタン", " button "], ["ページ", " page "], ["フォーム", " form "], ["テスト", " test "],
  ["関数", " function "], ["ファイル", " file "], ["ルート", " route "],
  // KR
  ["해주세요", ""], ["주세요", ""], ["해줘", ""],
  ["컴포넌트", " component "], ["패키지", " package "], ["업데이트", " update "],
  ["생성", " create "], ["만들", " create "], ["추가", " create "],
  ["삭제", " delete "], ["제거", " delete "],
  ["수정", " fix "], ["고치", " fix "], ["변경", " update "], ["설치", " install "],
  ["버튼", " button "], ["페이지", " page "], ["테스트", " test "],
  ["함수", " function "], ["파일", " file "], ["폼", " form "],
];
const CJK_SORTED = [...CJK_TERMS].sort((a, b) => b[0].length - a[0].length);
const CJK_ANY = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

const URL_RE = /\bhttps?:\/\/[^\s)]+/g;
export const PATH_RE =
  /(?:[\w.@~-]+\/)+[\w.@-]+|\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|json|ya?ml|toml|md|css|scss|html|py|rs|go|java|kt|swift|rb|php|c|h|cpp|sh|sql|vue|svelte)\b/g;
const NUM_RE = /(?<![\w$])\d+(?:\.\d+)?(?![\w])/g;
const TOKEN_RE = /\$[a-z]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー]+|[a-z0-9_]+/gu;

export interface IntentFingerprint {
  /** Space-joined sorted unique tokens; the lookup key. */
  key: string;
  tokens: string[];
}

function replaceCjk(text: string): string {
  let out = text;
  for (const [from, to] of CJK_SORTED) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

/** Workspace-looking paths mentioned in the message, for matcher file-overlap. */
export function extractMentionedPaths(message: string): string[] {
  const text = redactSecrets(String(message ?? ""));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(PATH_RE)) {
    const p = m[0].replace(/\\/g, "/");
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export function computeIntentFingerprint(message: string): IntentFingerprint {
  let text = redactSecrets(String(message ?? "")).normalize("NFKC").toLowerCase();
  text = text.replace(URL_RE, " $url ").replace(PATH_RE, " $path ").replace(NUM_RE, " $num ");
  // Keep `$` only for our own placeholders.
  text = text.replace(/\$(?!url\b|path\b|num\b)/g, " ");
  if (CJK_ANY.test(text)) text = replaceCjk(text);

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
