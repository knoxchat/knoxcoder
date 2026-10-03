/**
 * Secret redaction shared by tool output, memory, logs and prompt logs.
 *
 * Conservative on purpose: it targets well-known token shapes, private-key
 * blocks, bearer headers, URL credentials and `KEY=value` assignments whose
 * key name looks sensitive. Ordinary prose and code are left alone.
 */

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY =
  "(?:[A-Za-z0-9_.-]*(?:api[_-]?key|apikey|secret|token|passwd|password|pwd|private[_-]?key|access[_-]?key|auth|credential)s?[A-Za-z0-9_.-]*)";

const RULES: Array<{ re: RegExp; replace: string | ((...m: string[]) => string) }> = [
  // PEM / OpenSSH private key blocks (whole block).
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
    replace: "[REDACTED PRIVATE KEY]",
  },
  // URL credentials: scheme://user:pass@host
  {
    re: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)@/gi,
    replace: (_m, scheme, user) => `${scheme}${user}:${REDACTED}@`,
  },
  // Authorization / Bearer headers.
  {
    re: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g,
    replace: (_m, kind) => `${kind} ${REDACTED}`,
  },
  // Well-known token shapes.
  { re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, replace: REDACTED },
  { re: /\bsk-or-[A-Za-z0-9_-]{16,}/g, replace: REDACTED },
  { re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, replace: REDACTED },
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g, replace: REDACTED },
  { re: /\bgithub_pat_[A-Za-z0-9_]{30,}/g, replace: REDACTED },
  { re: /\bglpat-[A-Za-z0-9_-]{20,}/g, replace: REDACTED },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replace: REDACTED },
  { re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: REDACTED },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: REDACTED },
  { re: /\bnpm_[A-Za-z0-9]{30,}/g, replace: REDACTED },
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: REDACTED },
  // KEY=value / "key": "value" where the key name looks sensitive.
  {
    re: new RegExp(
      `(["']?${SENSITIVE_KEY}["']?\\s*[=:]\\s*)(["'])([^"'\\n]{6,})\\2`,
      "gi",
    ),
    replace: (_m, lead, q) => `${lead}${q}${REDACTED}${q}`,
  },
  {
    re: new RegExp(
      `((?:^|\\n|\\bexport\\s+|\\s)${SENSITIVE_KEY}=)([^\\s"'\`;&|()<>]{8,})`,
      "gi",
    ),
    replace: (_m, lead) => `${lead}${REDACTED}`,
  },
];

export function containsSecret(text: string): boolean {
  return redactSecrets(text) !== text;
}

export function redactSecrets(text: string): string {
  if (!text) {
    return text;
  }
  let out = text;
  for (const { re, replace } of RULES) {
    re.lastIndex = 0;
    out = out.replace(re, replace as never);
  }
  return out;
}

/** Redact `content` of context items (tool results) without mutating input. */
export function redactContextItems<T extends { content?: string }>(
  items: T[],
): T[] {
  return items.map((item) => {
    if (typeof item?.content !== "string") {
      return item;
    }
    const content = redactSecrets(item.content);
    return content === item.content ? item : { ...item, content };
  });
}

/** Redact string leaves of arbitrary log arguments. */
export function redactLogArg(arg: unknown): unknown {
  if (typeof arg === "string") {
    return redactSecrets(arg);
  }
  if (arg instanceof Error) {
    const copy = new Error(redactSecrets(arg.message));
    copy.name = arg.name;
    copy.stack = arg.stack ? redactSecrets(arg.stack) : undefined;
    return copy;
  }
  if (arg && typeof arg === "object") {
    try {
      const json = JSON.stringify(arg);
      const red = redactSecrets(json);
      return red === json ? arg : JSON.parse(red);
    } catch {
      return arg;
    }
  }
  return arg;
}

const SENSITIVE_FILE_RE =
  /(^|[\\/])(\.env(\.[^\\/]+)?|[^\\/]+\.pem|[^\\/]+\.p12|[^\\/]+\.pfx|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.netrc|credentials\.json)$/i;
const SAFE_TEMPLATE_RE = /\.(example|sample|template|dist|defaults?)$|\.pub$/i;

/** `.env*`, `*.pem`, `id_*` and similar need explicit approval to read. */
export function isSensitiveSecretFile(filePath: string): boolean {
  return SENSITIVE_FILE_RE.test(filePath) && !SAFE_TEMPLATE_RE.test(filePath);
}
