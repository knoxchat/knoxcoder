/**
 * MC-81: seeded property tests (no extra dependency). Same seed, same cases, so a failure reproduces.
 */
import { describe, expect, it } from "vitest";

import { computeIntentFingerprint, fingerprintSimilarity } from "./intentFingerprint";
import { extractSlots, isSafeSlotValue } from "./slots";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const WORDS = ["create", "react", "component", "add", "login", "button", "写", "组件", "install", "package", "fix", "bug", "src/app/index.ts", "v2", "42", "https://example.com/x", "Header", "user_service"];
const ALPHABET = "abcXYZ019_-./\\~:;|&$`'\"<>(){}[]*?!#%^= \t\n\u0000é中";

function sentence(r: () => number): string {
  const n = 1 + Math.floor(r() * 8);
  return Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]).join(" ");
}

function noise(r: () => number, max = 40): string {
  const n = Math.floor(r() * max);
  return Array.from({ length: n }, () => ALPHABET[Math.floor(r() * ALPHABET.length)]).join("");
}

describe("intent fingerprint properties (MC-81)", () => {
  const r = rng(1234);
  const cases = Array.from({ length: 300 }, () => sentence(r));

  it("is deterministic and a fixed point of re-fingerprinting its own tokens", () => {
    for (const c of cases) {
      const a = computeIntentFingerprint(c);
      expect(computeIntentFingerprint(c).key).toBe(a.key);
      expect(a.key).toBe(a.tokens.join(" "));
    }
  });

  it("is stable under case and whitespace changes", () => {
    for (const c of cases) {
      const base = computeIntentFingerprint(c).key;
      expect(computeIntentFingerprint(c.toUpperCase()).key).toBe(computeIntentFingerprint(c.toLowerCase()).key);
      expect(computeIntentFingerprint(`  ${c.replace(/ /g, " \t\n ")}  `).key).toBe(base);
    }
  });

  it("never throws and self-similarity is 1 for non-empty keys", () => {
    for (let i = 0; i < 300; i++) {
      const fp = computeIntentFingerprint(noise(r, 200)).key;
      if (fp) expect(fingerprintSimilarity(fp, fp)).toBe(1);
    }
  });
});

describe("slot safety properties (MC-81)", () => {
  it("a value that passes can't traverse, be absolute, or carry shell metacharacters", () => {
    const r = rng(99);
    let accepted = 0;
    for (let i = 0; i < 5000; i++) {
      const v = noise(r, 30);
      if (!isSafeSlotValue(v)) continue;
      accepted++;
      expect(v).not.toMatch(/\.\./);
      expect(v).not.toMatch(/^[/~]|^[A-Za-z]:/);
      expect(v).not.toMatch(/[\\\s;|&$`'"<>(){}[\]*?!#%^=\u0000]/);
    }
    expect(accepted).toBeGreaterThan(0);
  });

  it("known attacks are refused", () => {
    for (const v of ["../x", "a/../b", "/etc/passwd", "~/x", "C:\\x", "a;rm -rf /", "$(id)", "`id`", "a b", "a\nb", "", "x".repeat(121), "-rf"]) {
      expect(isSafeSlotValue(v), v).toBe(false);
    }
  });

  it("extractSlots never yields an unsafe value from hostile intents", () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const hostile = ["../../etc", "x;rm", "$(id)", "a/../b", "ok_name", "Header"][Math.floor(r() * 6)];
      const other = ["Footer", "Button", "ok_two"][Math.floor(r() * 3)];
      const pairs = extractSlots(
        { intentText: `create component ${hostile}`, files: [{ path: `src/${hostile}.tsx` }] },
        { intentText: `create component ${other}`, files: [{ path: `src/${other}.tsx` }] },
      );
      for (const p of pairs) for (const v of p.values) expect(isSafeSlotValue(v)).toBe(true);
    }
  });
});
