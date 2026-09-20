import { CJK_SIGNIFICANT_RATIO } from "./questions";

const CJK_CHAR =
  /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

/**
 * True when CJK (Han / kana / hangul) is a large share of the message.
 * Jev is weaker here; callers should fall back to regex on low confidence.
 */
export function isCjkHeavy(text: string, ratio = CJK_SIGNIFICANT_RATIO): boolean {
  let significant = 0;
  let cjk = 0;
  for (const char of text) {
    if (/\s/.test(char) || /[0-9!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(char)) {
      continue;
    }
    significant += 1;
    if (CJK_CHAR.test(char)) {
      cjk += 1;
    }
  }
  if (significant < 8) {
    return false;
  }
  return cjk / significant >= ratio;
}
