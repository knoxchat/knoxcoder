const TOKEN_COUNT_SUFFIXES = ["", "k", "m", "b", "t"] as const;

/**
 * Compact token counts for tight UI (turn meter, badges).
 * k = thousand, m = million, b = billion, t = trillion.
 * One decimal below 10 of a unit (`4.2k`, `1.4m`); integers at 10+ (`42k`, `12m`).
 */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) {
    return "0";
  }

  let scaled = tokens;
  let unitIndex = 0;
  while (scaled >= 1000 && unitIndex < TOKEN_COUNT_SUFFIXES.length - 1) {
    scaled /= 1000;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return String(Math.round(scaled));
  }

  const rounded =
    scaled < 10 ? Number(scaled.toFixed(1)) : Math.round(scaled);

  if (rounded >= 1000 && unitIndex < TOKEN_COUNT_SUFFIXES.length - 1) {
    return `1.0${TOKEN_COUNT_SUFFIXES[unitIndex + 1]}`;
  }

  const text =
    scaled < 10 && rounded < 10 ? rounded.toFixed(1) : String(rounded);
  return `${text}${TOKEN_COUNT_SUFFIXES[unitIndex]}`;
}
