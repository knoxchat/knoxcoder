/**
 * InputSanitizer — Security scanning for all memory writes.
 *
 * Scans for:
 * - Prompt injection attempts (role hijacking, system prompt overrides)
 * - Credential exfiltration patterns (API keys, tokens, passwords)
 * - Invisible Unicode characters (zero-width, RTL overrides, homoglyphs)
 * - Command injection patterns (shell commands, SQL injection)
 * - Excessive repetition / padding attacks
 *
 * Gates all store, auto_extract, batch_store, and import paths.
 */

export interface SanitizeResult {
  safe: boolean;
  cleaned: string;
  threats: SanitizeThreat[];
}

export interface SanitizeThreat {
  type: ThreatType;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  position?: number;
}

export type ThreatType =
  | "prompt_injection"
  | "role_hijacking"
  | "credential_leak"
  | "invisible_unicode"
  | "command_injection"
  | "excessive_repetition"
  | "data_exfiltration"
  | "encoding_attack";

export class InputSanitizer {
  // ── Prompt Injection Patterns ────────────────────────────────────────────

  private static readonly PROMPT_INJECTION_PATTERNS: Array<{ pattern: RegExp; description: string; severity: "medium" | "high" | "critical" }> = [
    // System prompt overrides
    { pattern: /(?:^|\n)\s*(?:system\s*:|<\|?system\|?>|<<\s*SYS\s*>>)/i, description: "System prompt override attempt", severity: "critical" },
    { pattern: /(?:ignore|forget|disregard)\s+(?:all\s+)?(?:previous|above|prior|earlier)\s+(?:instructions?|prompts?|rules?|context)/i, description: "Instruction override attempt", severity: "critical" },
    { pattern: /(?:you\s+are\s+now|act\s+as|pretend\s+(?:to\s+be|you\s*(?:'re|are))|your\s+new\s+(?:role|instructions?))/i, description: "Role hijacking attempt", severity: "high" },
    { pattern: /(?:reveal|show|display|output|print)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?|rules?|guidelines?)/i, description: "Prompt extraction attempt", severity: "high" },

    // Jailbreak patterns
    { pattern: /\bDAN\b.*\bmode\b|\bDAN\b.*\bjailbreak\b/i, description: "DAN jailbreak pattern", severity: "critical" },
    { pattern: /(?:developer|debug|admin|root|sudo)\s+(?:mode|access|override)/i, description: "Privilege escalation attempt", severity: "high" },

    // Delimiter injection
    { pattern: /<\/?(?:system|user|assistant|human|ai|tool|function)(?:\s[^>]*)?\s*>/i, description: "Chat delimiter injection", severity: "high" },
    { pattern: /\[(?:INST|\/INST|SYS|\/SYS)\]/i, description: "Instruction tag injection", severity: "high" },

    // Indirect injection via memory
    { pattern: /(?:when\s+(?:recalled|retrieved|loaded|read))\s*,?\s*(?:execute|run|perform|do)/i, description: "Delayed execution injection", severity: "critical" },
    { pattern: /(?:next\s+time|in\s+future|from\s+now\s+on)\s*,?\s*(?:always|must|should)\s+(?:execute|run|output|respond)/i, description: "Persistent behavior modification", severity: "high" },
  ];

  // ── Credential Patterns ──────────────────────────────────────────────────

  private static readonly CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
    // API keys and tokens
    { pattern: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{20,}['"]?/i, description: "API key detected" },
    { pattern: /(?:bearer|token|auth)\s+[A-Za-z0-9_\-.]{20,}/i, description: "Bearer/auth token detected" },
    { pattern: /(?:sk|pk|rk)[-_][a-zA-Z0-9]{20,}/i, description: "Secret/public key detected" },

    // AWS
    { pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/i, description: "AWS access key detected" },
    { pattern: /(?:aws[_-]?secret[_-]?access[_-]?key)\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/i, description: "AWS secret key detected" },

    // Common service tokens
    { pattern: /ghp_[A-Za-z0-9]{36}/i, description: "GitHub personal access token detected" },
    { pattern: /gho_[A-Za-z0-9]{36}/i, description: "GitHub OAuth token detected" },
    { pattern: /xox[bpsar]-[A-Za-z0-9\-]{10,}/i, description: "Slack token detected" },

    // Passwords in connection strings
    { pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"]?[^\s'"]{8,}['"]?/i, description: "Password in connection string" },
    { pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^:]+:[^@]+@/i, description: "Database connection string with credentials" },

    // Private keys
    { pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/i, description: "Private key detected" },
    { pattern: /-----BEGIN\s+(?:OPENSSH\s+)?PRIVATE\s+KEY-----/i, description: "SSH private key detected" },
  ];

  // ── Invisible Unicode Ranges ─────────────────────────────────────────────

  private static readonly INVISIBLE_UNICODE: RegExp = new RegExp(
    "[" +
    "\u200B-\u200F" +   // Zero-width space, joiners, directional marks
    "\u2028-\u202F" +   // Line/paragraph separators, embedding controls
    "\u2060-\u2069" +   // Word joiner, invisible operators
    "\uFEFF" +          // BOM / zero-width no-break space
    "\uFFF9-\uFFFB" +   // Interlinear annotation anchors
    "\u00AD" +          // Soft hyphen
    "\u034F" +          // Combining grapheme joiner
    "\u061C" +          // Arabic letter mark
    "\u115F-\u1160" +   // Hangul fillers
    "\u17B4-\u17B5" +   // Khmer vowel inherent
    "\u180E" +          // Mongolian vowel separator
    "]",
    "g",
  );

  // ── Command Injection Patterns ───────────────────────────────────────────

  private static readonly COMMAND_INJECTION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
    { pattern: /;\s*(?:rm|del|format|drop|truncate|shutdown|reboot)\s/i, description: "Destructive command injection" },
    { pattern: /(?:\$\(|`)\s*(?:curl|wget|nc|ncat|bash|sh|cmd|powershell)/i, description: "Remote execution injection" },
    // Destructive/chained SQL — allow benign snippets (SELECT …; -- comment) in stored memory
    { pattern: /(?:UNION\s+ALL\s+SELECT|UNION\s+SELECT|;\s*DROP\s+TABLE|;\s*DELETE\s+FROM|;\s*INSERT\s+INTO|'\s*OR\s+['"]?\d+['"]?\s*=\s*['"]?\d+|OR\s+1\s*=\s*1\s*--)/i, description: "SQL injection pattern" },
    { pattern: /(?:eval|exec|spawn|system)\s*\(/i, description: "Code execution function" },
  ];

  // ── Main Sanitization Entry Point ────────────────────────────────────────

  /**
   * Scan content for security threats.
   * Returns a SanitizeResult with cleaned content and any detected threats.
   *
   * By default, cleans invisible Unicode but only warns on other threats
   * (allowing the caller to decide whether to reject).
   */
  static scan(content: string): SanitizeResult {
    const threats: SanitizeThreat[] = [];
    let cleaned = content;

    // 1. Invisible Unicode detection and removal
    const invisibleMatches = content.match(InputSanitizer.INVISIBLE_UNICODE);
    if (invisibleMatches && invisibleMatches.length > 0) {
      threats.push({
        type: "invisible_unicode",
        severity: invisibleMatches.length > 5 ? "high" : "medium",
        description: `Found ${invisibleMatches.length} invisible Unicode character(s)`,
      });
      cleaned = cleaned.replace(InputSanitizer.INVISIBLE_UNICODE, "");
    }

    // 2. Prompt injection scanning
    for (const { pattern, description, severity } of InputSanitizer.PROMPT_INJECTION_PATTERNS) {
      const match = pattern.exec(content);
      if (match) {
        threats.push({
          type: pattern.source.includes("role") || pattern.source.includes("pretend")
            ? "role_hijacking"
            : "prompt_injection",
          severity,
          description,
          position: match.index,
        });
      }
    }

    // 3. Credential scanning
    for (const { pattern, description } of InputSanitizer.CREDENTIAL_PATTERNS) {
      const match = pattern.exec(content);
      if (match) {
        threats.push({
          type: "credential_leak",
          severity: "critical",
          description,
          position: match.index,
        });
        // Redact the credential in cleaned output
        cleaned = cleaned.replace(match[0], "[REDACTED]");
      }
    }

    // 4. Command injection scanning
    for (const { pattern, description } of InputSanitizer.COMMAND_INJECTION_PATTERNS) {
      const match = pattern.exec(content);
      if (match) {
        threats.push({
          type: "command_injection",
          severity: "high",
          description,
          position: match.index,
        });
      }
    }

    // 5. Excessive repetition detection (padding attacks)
    const repetitionResult = InputSanitizer.detectExcessiveRepetition(content);
    if (repetitionResult) {
      threats.push(repetitionResult);
      // Collapse excessive repetition
      cleaned = InputSanitizer.collapseRepetition(cleaned);
    }

    // Determine overall safety
    const hasCritical = threats.some((t) => t.severity === "critical");
    const hasHigh = threats.some((t) => t.severity === "high");

    return {
      safe: !hasCritical && !hasHigh,
      cleaned,
      threats,
    };
  }

  /**
   * Scan and reject if unsafe. Throws on critical/high threats.
   * Use this as a gate for memory writes.
   */
  static enforce(content: string, context?: string): string {
    const result = InputSanitizer.scan(content);

    if (!result.safe) {
      const criticalThreats = result.threats.filter((t) =>
        t.severity === "critical" || t.severity === "high",
      );
      const descriptions = criticalThreats.map((t) => `[${t.severity}] ${t.description}`);
      throw new Error(
        `Memory write blocked by security scanner${context ? ` (${context})` : ""}:\n${descriptions.join("\n")}`,
      );
    }

    // Return cleaned content (invisible Unicode removed, credentials redacted)
    return result.cleaned;
  }

  /**
   * Lightweight check — returns true if content has any threats.
   * Does not clean or throw.
   */
  static hasThreats(content: string): boolean {
    return !InputSanitizer.scan(content).safe;
  }

  // ── Repetition Detection ─────────────────────────────────────────────────

  private static detectExcessiveRepetition(content: string): SanitizeThreat | null {
    // Check for single character repetition (>100 same char)
    if (/(.)\1{99,}/.test(content)) {
      return {
        type: "excessive_repetition",
        severity: "medium",
        description: "Excessive single-character repetition detected (>100 chars)",
      };
    }

    // Check for phrase repetition (same 5+ word phrase repeated 5+ times)
    const words = content.split(/\s+/);
    if (words.length > 20) {
      const phrases = new Map<string, number>();
      for (let i = 0; i < words.length - 4; i++) {
        const phrase = words.slice(i, i + 5).join(" ").toLowerCase();
        phrases.set(phrase, (phrases.get(phrase) ?? 0) + 1);
      }
      for (const [phrase, count] of phrases) {
        if (count >= 5) {
          return {
            type: "excessive_repetition",
            severity: "medium",
            description: `Phrase "${phrase.substring(0, 40)}..." repeated ${count} times`,
          };
        }
      }
    }

    return null;
  }

  private static collapseRepetition(content: string): string {
    // Collapse single-char runs
    let result = content.replace(/(.)\1{49,}/g, (match, char) => char.repeat(10) + `... (${match.length} chars collapsed)`);

    // Collapse repeated lines
    const lines = result.split("\n");
    if (lines.length > 20) {
      const collapsed: string[] = [];
      let lastLine = "";
      let repeatCount = 0;
      for (const line of lines) {
        if (line.trim() === lastLine.trim() && line.trim().length > 0) {
          repeatCount++;
          if (repeatCount <= 2) {
            collapsed.push(line);
          } else if (repeatCount === 3) {
            collapsed.push(`... (repeated ${repeatCount} more times)`);
          }
        } else {
          if (repeatCount > 3) {
            collapsed[collapsed.length - 1] = `... (repeated ${repeatCount} times total)`;
          }
          collapsed.push(line);
          lastLine = line;
          repeatCount = 0;
        }
      }
      result = collapsed.join("\n");
    }

    return result;
  }

  // ── Batch Scanning ───────────────────────────────────────────────────────

  /**
   * Scan multiple items and return results for each.
   * Used for batch_store and import operations.
   */
  static scanBatch(items: Array<{ id?: string; content: string }>): Array<{ id?: string; result: SanitizeResult }> {
    return items.map((item) => ({
      id: item.id,
      result: InputSanitizer.scan(item.content),
    }));
  }

  /**
   * Enforce security on batch items. Returns cleaned items, throws if any are unsafe.
   */
  static enforceBatch(items: Array<{ content: string; [key: string]: any }>): typeof items {
    return items.map((item, idx) => ({
      ...item,
      content: InputSanitizer.enforce(item.content, `batch item ${idx}`),
    }));
  }
}
