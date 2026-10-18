import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { RetrievalFusion } from "./RetrievalFusion.js";
import { buildFts5Query, contentWords } from "./RetrievalQuery.js";
import {
  cjkBigrams,
  cjkExpandSql,
  cjkIndexTokens,
  expandCjkForFts,
  isCjkToken,
} from "./cjkFts.js";
import type { DatabaseConnection } from "../../../util/refreshIndex.js";

const openMem = () => open({ filename: ":memory:", driver: sqlite3.Database });
let live: Awaited<ReturnType<typeof openMem>> | undefined;

afterEach(async () => {
  await live?.close().catch(() => {});
  live = undefined;
});

describe("CJK FTS bigrams", () => {
  it("emits overlapping bigrams and keeps latin tokens", () => {
    expect(cjkBigrams("迁移")).toEqual(["迁移"]);
    expect(cjkBigrams("迁移怎么写")).toEqual(["迁移", "移怎", "怎么", "么写"]);
    expect(cjkIndexTokens("每个迁移都要写 down")).toContain("迁移");
    expect(expandCjkForFts("hello")).toBe("hello");
    expect(expandCjkForFts("迁移怎么写")).toContain("迁移");
    expect(isCjkToken("迁移")).toBe(true);
    expect(isCjkToken("readme")).toBe(false);
  });

  it("contentWords keeps Chinese bigrams that unicode61 would drop", () => {
    const words = contentWords("我要给用户表加一个字段，迁移怎么写");
    expect(words).toContain("迁移");
    expect(words).toContain("怎么");
    expect(contentWords("now update the README")).toEqual(["update", "readme"]);
  });

  it("CJK MATCH clauses OR bigrams instead of ANDing three of them", () => {
    const fts = buildFts5Query("我要给用户表加一个字段，迁移怎么写");
    expect(fts).toBeTruthy();
    expect(fts).toContain('"迁移"');
    expect(fts).toContain(" OR ");
    expect(fts).not.toContain(" AND ");
  });

  it("latin queries still AND content words", () => {
    expect(buildFts5Query("ok now update the README please")).toBe(
      "update* AND readme*",
    );
  });

  it("SQL expander only accepts identifiers", () => {
    expect(cjkExpandSql("new.content")).toContain("cjk_seq");
    expect(() => cjkExpandSql("content; drop")).toThrow(/unsafe/);
  });

  it("FTS MATCH finds a CJK substring after trigger expand", async () => {
    live = await openMem();
    await live.exec(`
      CREATE TABLE brain_semantic (
        id INTEGER PRIMARY KEY,
        title TEXT,
        content TEXT,
        keywords TEXT
      );
      CREATE TABLE brain_episodic (
        id INTEGER PRIMARY KEY,
        content TEXT
      );
    `);
    await RetrievalFusion.initFts5Tables(live as unknown as DatabaseConnection);
    await live.run(
      `INSERT INTO brain_semantic(id, title, content, keywords)
       VALUES (1, '数据库迁移必须可回滚', '每个迁移都要写 down 脚本，生产环境先演练', '数据库, 迁移, 回滚')`,
    );
    const row = await live.get<{ id: number }>(
      `SELECT rowid AS id FROM brain_semantic_fts WHERE brain_semantic_fts MATCH '"迁移"'`,
    );
    expect(row?.id).toBe(1);
  });
});
