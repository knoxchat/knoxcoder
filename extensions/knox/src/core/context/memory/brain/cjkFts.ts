/**
 * CJK-aware sqlite FTS helpers (no custom tokenizer, no embeddings).
 *
 * FTS5 `unicode61` treats a Han/kana/hangul run as one token, so a query
 * bigram like 迁移 never MATCH-es 每个迁移都要写. Index and query both
 * add overlapping character bigrams. CJK-heavy MATCH clauses must OR those
 * bigrams (AND of three kills recall).
 */

/** Han / kana / hangul — same ranges as `jev/cjk.ts`. */
export const CJK_CHAR =
  /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u;
export const CJK_RUN =
  /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+/gu;

const COL_OK = /^(?:new|old)\.[A-Za-z_]+$|^[A-Za-z_]+$/;

export function isCjkToken(token: string): boolean {
  return token.length > 0 && CJK_CHAR.test(token);
}

/** Overlapping 2-char windows. A 2-char run is the token itself. */
export function cjkBigrams(run: string): string[] {
  if (run.length < 2) {
    return [];
  }
  if (run.length === 2) {
    return [run];
  }
  const out: string[] = [];
  for (let i = 0; i < run.length - 1; i++) {
    out.push(run.slice(i, i + 2));
  }
  return out;
}

/** Unique overlapping CJK bigrams in text order. */
export function cjkIndexTokens(text: string): string[] {
  if (!text) {
    return [];
  }
  const seen = new Set<string>();
  const tokens: string[] = [];
  const runs = text.match(CJK_RUN) ?? [];
  for (const run of runs) {
    for (const bg of cjkBigrams(run)) {
      if (seen.has(bg)) {
        continue;
      }
      seen.add(bg);
      tokens.push(bg);
    }
  }
  return tokens;
}

/** Append bigrams so unicode61 can MATCH a substring of a CJK run. */
export function expandCjkForFts(text: string | null | undefined): string {
  const src = text ?? "";
  const extra = cjkIndexTokens(src);
  if (extra.length === 0) {
    return src;
  }
  return `${src} ${extra.join(" ")}`;
}

function cjkCharSql(column: string, indexExpr: string): string {
  const ch = `unicode(substr(${column}, ${indexExpr}, 1))`;
  return `(${ch} BETWEEN 12352 AND 12543 OR ${ch} BETWEEN 13312 AND 40959 OR ${ch} BETWEEN 44032 AND 55215 OR ${ch} BETWEEN 63744 AND 64255)`;
}

/**
 * Scalar SQL that appends overlapping CJK bigrams. Column must be a
 * trigger/table identifier (`title`, `new.content`), never user text.
 * The `cjk_seq` identifier marks upgraded FTS triggers.
 */
export function cjkExpandSql(column: string): string {
  if (!COL_OK.test(column)) {
    throw new Error(`cjkExpandSql: unsafe column ${column}`);
  }
  return `(${column} || ' ' || ifnull((
    SELECT group_concat(substr(${column}, i, 2), ' ')
    FROM (
      WITH RECURSIVE cjk_seq(i) AS (
        SELECT 1
        UNION ALL
        SELECT i + 1 FROM cjk_seq WHERE i < length(${column})
      )
      SELECT i FROM cjk_seq
      WHERE i < length(${column})
        AND ${cjkCharSql(column, "i")}
        AND ${cjkCharSql(column, "i + 1")}
    )
  ), ''))`;
}
