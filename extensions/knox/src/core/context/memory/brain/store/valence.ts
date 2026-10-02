/** Heuristic emotional valence and salience. */

import type {
  EmotionalValence
} from "../types.js";

// ── Emotional Valence Detection ────────────────────────────────────────────

/**
 * Auto-detect emotional valence from content using heuristic rules.
 * Mirrors Knox-MS amygdala salience markers.
 */
export function detectEmotionalValence(content: string, role: string): EmotionalValence {
  const lower = content.toLowerCase();

  // Urgency markers
  if (/\b(urgent|critical|asap|immediately|deadline|must fix|breaking|blocker|p0|p1)\b/.test(lower))
    return "urgency";

  // Negative markers (errors, frustration)
  if (/\b(error|bug|crash|fail|broken|wrong|issue|problem|annoying|frustrat|stuck|doesn'?t work|can'?t)\b/.test(lower))
    return "negative";

  // Surprise / discovery
  if (/\b(wow|interesting|didn'?t know|unexpected|surprising|actually|turns out|discovered|never knew|whoa)\b/.test(lower))
    return "surprise";

  // Positive markers (success, excitement)
  if (/\b(works|solved|fixed|success|perfect|great|excellent|awesome|thank|nice|done|finally|working)\b/.test(lower))
    return "positive";

  // Curiosity markers
  if (/\b(how does|why does|what if|wonder|curious|explore|understand|learn|explain)\b/.test(lower) || lower.includes("?"))
    return "curiosity";

  return "neutral";
}

/**
 * Compute salience (emotional intensity) score.
 * Combines content signals (exclamation marks, caps, strong language) with importance.
 */
export function computeSalience(content: string, role: string, importance: number): number {
  let salience = 0.4;

  // Exclamation marks signal intensity
  const exclamations = (content.match(/!/g) ?? []).length;
  salience += Math.min(exclamations * 0.05, 0.15);

  // ALL-CAPS words signal intensity
  const capsWords = (content.match(/\b[A-Z]{3,}\b/g) ?? []).length;
  salience += Math.min(capsWords * 0.05, 0.15);

  // Strong signal words
  if (/\b(critical|urgent|must|never|always|important|remember)\b/i.test(content))
    salience += 0.15;

  // Code blocks (technical salience)
  if (content.includes("```"))
    salience += 0.1;

  // Blend with importance score
  salience = salience * 0.6 + importance * 0.4;

  // User messages carry slightly more emotional signal
  if (role === "user") salience += 0.05;

  return Math.min(1.0, Math.max(0.1, salience));
}
