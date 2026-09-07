/**
 * Pinned rustdoc / registry source lookup (RL-28 / RL-29).
 *
 * Ground truth is rustdoc JSON or the locked crate sources — not docs.rs.
 */

import { resolvePinnedCrates } from "../../context/cargoCard";

export const RUSTDOC_FALLBACK_MARKER = "pinned registry/vendor source";

export interface RustdocHit {
  name: string;
  docs?: string;
  signature?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function itemName(
  item: Record<string, unknown>,
  pathHint?: string,
): string {
  if (typeof item.name === "string" && item.name) {
    return item.name;
  }
  return pathHint ?? "";
}

function itemDocs(item: Record<string, unknown>): string | undefined {
  return typeof item.docs === "string" && item.docs.trim()
    ? item.docs.trim()
    : undefined;
}

function rustdocTypeToString(ty: unknown, depth = 0): string {
  if (depth > 8) {
    return "_";
  }
  if (typeof ty === "string") {
    return ty === "unit" ? "()" : ty;
  }
  if (ty == null) {
    return "";
  }
  const rec = asRecord(ty);
  if (!rec) {
    return "";
  }
  if (typeof rec.generic === "string") {
    return rec.generic;
  }
  if (typeof rec.primitive === "string") {
    return rec.primitive;
  }
  const resolved = asRecord(rec.resolved_path);
  if (resolved) {
    const path =
      typeof resolved.path === "string"
        ? resolved.path
        : typeof resolved.name === "string"
          ? resolved.name
          : "";
    const args = rustdocGenericArgs(resolved.args, depth + 1);
    return args ? `${path}${args}` : path;
  }
  const borrowed = asRecord(rec.borrowed_ref);
  if (borrowed) {
    const life =
      typeof borrowed.lifetime === "string" ? `${borrowed.lifetime} ` : "";
    const mut =
      borrowed.is_mutable === true || borrowed.mutability === "mut" ? "mut " : "";
    return `&${life}${mut}${rustdocTypeToString(borrowed.type, depth + 1)}`;
  }
  const raw = asRecord(rec.raw_pointer);
  if (raw) {
    const mut =
      raw.is_mutable === true || raw.mutability === "mut" ? "mut" : "const";
    return `*${mut} ${rustdocTypeToString(raw.type, depth + 1)}`;
  }
  if (Array.isArray(rec.tuple)) {
    return `(${rec.tuple.map((item) => rustdocTypeToString(item, depth + 1)).join(", ")})`;
  }
  const slice = rec.slice;
  if (slice && typeof slice === "object") {
    return `[${rustdocTypeToString(slice, depth + 1)}]`;
  }
  const array = asRecord(rec.array);
  if (array) {
    const len = typeof array.len === "string" ? array.len : "";
    return `[${rustdocTypeToString(array.type, depth + 1)}; ${len}]`;
  }
  if (rec.output !== undefined || rec.inputs !== undefined) {
    return formatFnDecl(rec, "fn", undefined, depth);
  }
  return "";
}

function rustdocGenericArgs(args: unknown, depth: number): string {
  const rec = asRecord(args);
  const angled = asRecord(rec?.angle_bracketed);
  const list = Array.isArray(angled?.args) ? angled.args : [];
  if (!list.length) {
    return "";
  }
  const inner = list
    .map((arg) => {
      const item = asRecord(arg);
      const ty = item?.type ?? item?.lifetime ?? arg;
      return rustdocTypeToString(ty, depth);
    })
    .filter(Boolean);
  return inner.length ? `<${inner.join(", ")}>` : "";
}

function formatFnHeader(header?: Record<string, unknown>): string {
  const bits: string[] = [];
  if (header?.is_const === true || header?.const === true) {
    bits.push("const");
  }
  if (header?.is_async === true || header?.async === true) {
    bits.push("async");
  }
  if (header?.is_unsafe === true || header?.unsafe === true) {
    bits.push("unsafe");
  }
  bits.push("fn");
  return bits.join(" ");
}

function formatFnInput(input: unknown, depth: number): string {
  if (Array.isArray(input) && input.length >= 2) {
    const name = typeof input[0] === "string" ? input[0] : "_";
    const ty = rustdocTypeToString(input[1], depth);
    return ty ? `${name}: ${ty}` : name;
  }
  const rec = asRecord(input);
  if (!rec) {
    return "_";
  }
  const name = typeof rec.name === "string" ? rec.name : "_";
  const ty = rustdocTypeToString(rec.type, depth);
  return ty ? `${name}: ${ty}` : name;
}

function formatFnDecl(
  decl: Record<string, unknown>,
  name: string,
  header?: Record<string, unknown>,
  depth = 0,
): string {
  const inputs = Array.isArray(decl.inputs)
    ? decl.inputs.map((input) => formatFnInput(input, depth + 1)).join(", ")
    : "";
  const outputRaw = decl.output;
  const output =
    outputRaw == null ||
    outputRaw === "unit" ||
    (asRecord(outputRaw) && Object.keys(asRecord(outputRaw)!).length === 0)
      ? ""
      : ` -> ${rustdocTypeToString(outputRaw, depth + 1)}`;
  return `${formatFnHeader(header)} ${name}(${inputs})${output}`;
}

function itemSignature(
  item: Record<string, unknown>,
  fallbackName?: string,
): string | undefined {
  if (typeof item.decl === "string" && item.decl.trim()) {
    return item.decl.trim();
  }
  const inner = asRecord(item.inner);
  if (!inner) {
    return undefined;
  }
  for (const key of ["function", "struct", "enum", "trait", "type_alias", "constant"]) {
    const nested = asRecord(inner[key]);
    if (!nested) {
      continue;
    }
    if (typeof nested.decl === "string" && nested.decl.trim()) {
      return nested.decl.trim();
    }
    if (typeof nested.header === "string" && nested.header.trim()) {
      return nested.header.trim();
    }
    const decl = asRecord(nested.decl) ?? asRecord(nested.sig);
    if (decl && key === "function") {
      const header = asRecord(nested.header);
      const name = itemName(item, fallbackName) || "fn";
      return formatFnDecl(decl, name, header);
    }
    if (key !== "function") {
      return `${key} ${itemName(item, fallbackName)}`.trim();
    }
  }
  return undefined;
}

function pathHintFrom(
  paths: Record<string, unknown>,
  id: string,
): string | undefined {
  const entry = asRecord(paths[id]);
  const path = entry?.path;
  if (Array.isArray(path) && path.length) {
    const last = path[path.length - 1];
    return typeof last === "string" ? last : undefined;
  }
  return typeof entry?.name === "string" ? entry.name : undefined;
}

export function parseRustdocItems(jsonText: string): RustdocHit[] {
  const parsed = JSON.parse(jsonText) as unknown;
  const root = asRecord(parsed);
  const index = asRecord(root?.index) ?? {};
  const paths = asRecord(root?.paths) ?? {};
  const hits: RustdocHit[] = [];
  for (const [id, value] of Object.entries(index)) {
    const item = asRecord(value);
    if (!item) {
      continue;
    }
    const name = itemName(item, pathHintFrom(paths, id));
    if (!name) {
      continue;
    }
    hits.push({
      name,
      docs: itemDocs(item),
      signature: itemSignature(item, name),
    });
  }
  return hits;
}

export function lookupRustdocSymbol(
  jsonText: string,
  query: string,
): string | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return undefined;
  }
  const short = needle.includes("::")
    ? needle.slice(needle.lastIndexOf("::") + 2)
    : needle;
  const hits = parseRustdocItems(jsonText).filter((item) => {
    const name = item.name.toLowerCase();
    return name === needle || name === short || name.endsWith(`::${short}`);
  });
  if (!hits.length) {
    return undefined;
  }
  return hits
    .slice(0, 5)
    .map((item) => {
      const lines = [`${item.name}`];
      if (item.signature) {
        lines.push(item.signature);
      }
      if (item.docs) {
        lines.push(item.docs);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

export function crateSourceReadHints(
  crate: string,
  version?: string,
): string {
  const verDir = version ? `${crate}-${version}` : `${crate}-<locked-version>`;
  return [
    `Read pinned source (do not invent APIs, do not scrape docs.rs):`,
    `- vendor/${crate}/src/ or vendor/${verDir}/src/`,
    `- ~/.cargo/registry/src/*/${verDir}/src/`,
  ].join("\n");
}

export function formatDocLookupFallback(opts: {
  symbol?: string;
  cargoToml?: string;
  cargoLock?: string;
}): string {
  const symbol = opts.symbol?.trim();
  const crateGuess = symbol?.includes("::")
    ? symbol.split("::")[0]
    : symbol;
  const pinned = resolvePinnedCrates(opts.cargoToml ?? "", opts.cargoLock);
  const match = crateGuess
    ? pinned.crates.find(
        (crate) => crate.name.toLowerCase() === crateGuess.toLowerCase(),
      )
    : undefined;
  const lines = [
    symbol
      ? `No rustdoc JSON for ${symbol}.`
      : "builtin_build action=doc needs a symbol (e.g. doc: tokio::sync::Mutex).",
    "Prefer rust-analyzer hover / goToDefinition. Do not scrape docs.rs as ground truth.",
  ];
  if (!pinned.hasLock) {
    lines.push(
      "No Cargo.lock — run cargo generate-lockfile before reading crate APIs.",
    );
  } else if (match) {
    lines.push(crateSourceReadHints(match.name, match.version));
  } else if (pinned.crates.length) {
    const list = pinned.crates
      .slice(0, 8)
      .map((crate) => `${crate.name} ${crate.version}`)
      .join(", ");
    lines.push(`Pinned crates: ${list}.`);
    lines.push(crateSourceReadHints(crateGuess || "<crate>"));
  } else {
    lines.push(crateSourceReadHints(crateGuess || "<crate>"));
  }
  lines.push(RUSTDOC_FALLBACK_MARKER);
  return lines.join("\n");
}
