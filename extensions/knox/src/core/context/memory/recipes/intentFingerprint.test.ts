import { describe, expect, it } from "vitest";
import { computeIntentFingerprint, fingerprintSimilarity, intentFingerprint } from "./intentFingerprint.js";

describe("intentFingerprint (MC-20)", () => {
  it("maps English paraphrases to the same fingerprint", () => {
    const a = intentFingerprint("Please create a React component called Button");
    const b = intentFingerprint("can you add the button React component");
    const c = intentFingerprint("make a new  Button  react component!");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toBe("button component create react");
  });

  it("maps ZH and EN to the same fingerprint where expected", () => {
    const en = intentFingerprint("create a React component Button");
    expect(intentFingerprint("请帮我创建一个 React 组件 Button")).toBe(en);
    expect(intentFingerprint("新建 Button 组件 react")).toBe(en);
  });

  it("maps ZH paraphrases together", () => {
    expect(intentFingerprint("删除 login 页面")).toBe(intentFingerprint("请帮我移除一个 login page"));
  });

  it("turns paths, urls and numbers into placeholders", () => {
    expect(intentFingerprint("fix bug in src/app/main.ts line 42")).toBe(
      intentFingerprint("Fix bug in lib/other/util.ts line 7"),
    );
    expect(computeIntentFingerprint("fetch https://example.com/x 3 times").tokens).toEqual(
      expect.arrayContaining(["$url", "$num"]),
    );
  });

  it("keeps different intents apart", () => {
    expect(intentFingerprint("create Button component")).not.toBe(intentFingerprint("delete Button component"));
  });

  it("is idempotent and stable under whitespace, case and order", () => {
    for (const m of ["Create the Login page", "请创建 登录 页面 /src/a.ts 5", "  FIX   tests  "]) {
      const f = intentFingerprint(m);
      expect(intentFingerprint(f)).toBe(f);
    }
    expect(intentFingerprint("button component create")).toBe(intentFingerprint("CREATE   component\n button"));
  });

  it("redacts secrets", () => {
    const f = intentFingerprint("set key sk-abcdefghijklmnopqrstuvwxyz0123456789 in config");
    expect(f).not.toContain("abcdefghijklmnop");
  });

  it("handles empty input", () => {
    expect(intentFingerprint("")).toBe("");
    expect(fingerprintSimilarity("", "a")).toBe(0);
    expect(fingerprintSimilarity("a b", "a b")).toBe(1);
  });
});
