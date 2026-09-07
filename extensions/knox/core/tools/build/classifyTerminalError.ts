/**
 * Classify terminal / agent-shell output (HL-10).
 * Used by the VS Code TerminalMonitor and tests; keep gcc/panic patterns
 * ahead of generic `Error:` so kernel builds are build/runtime, not npm.
 */

export type TerminalErrorCategory =
  | "build"
  | "test"
  | "runtime"
  | "dependency"
  | "general";

export interface ClassifiedTerminalError {
  pattern: string;
  matchedText: string;
  category: TerminalErrorCategory;
  severity: "error" | "warning";
  suggestedAction: string;
}

interface ErrorPattern {
  regex: RegExp;
  category: ClassifiedTerminalError["category"];
  severity: ClassifiedTerminalError["severity"];
  suggestedAction: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // Systems / C (must run before generic Error:)
  {
    regex: /:\d+(?::\d+)?:\s+(?:fatal\s+)?error:/i,
    category: "build",
    severity: "error",
    suggestedAction: "Fix compiler error",
  },
  {
    regex: /undefined reference to/i,
    category: "build",
    severity: "error",
    suggestedAction: "Fix linker error",
  },
  {
    regex: /Kernel panic(?: - not syncing)?/i,
    category: "runtime",
    severity: "error",
    suggestedAction: "Diagnose kernel panic",
  },
  {
    regex: /qemu-system-[\w-]+:/i,
    category: "runtime",
    severity: "error",
    suggestedAction: "Diagnose QEMU failure",
  },
  {
    regex: /^FAILED:\s+/i,
    category: "build",
    severity: "error",
    suggestedAction: "Fix ninja / kselftest FAILED line",
  },

  // TypeScript / JavaScript build errors
  {
    regex: /error TS\d+:/i,
    category: "build",
    severity: "error",
    suggestedAction: "Fix TypeScript errors",
  },
  {
    regex: /SyntaxError:/i,
    category: "build",
    severity: "error",
    suggestedAction: "Fix syntax error",
  },
  {
    regex: /Cannot find module ['"](.+?)['"]/i,
    category: "dependency",
    severity: "error",
    suggestedAction: "Install missing module",
  },
  {
    regex: /Module not found/i,
    category: "dependency",
    severity: "error",
    suggestedAction: "Install missing module",
  },

  // npm / yarn / pnpm errors
  {
    regex: /npm ERR!/i,
    category: "dependency",
    severity: "error",
    suggestedAction: "Fix npm error",
  },
  {
    regex: /ERR_PNPM/i,
    category: "dependency",
    severity: "error",
    suggestedAction: "Fix pnpm error",
  },
  {
    regex: /error.*ENOENT/i,
    category: "build",
    severity: "error",
    suggestedAction: "Fix missing file",
  },

  // Test failures
  {
    regex: /FAIL\s+[\w/\\]+\.(test|spec)\.\w+/i,
    category: "test",
    severity: "error",
    suggestedAction: "Fix failing tests",
  },
  {
    regex: /Tests?:\s+\d+ failed/i,
    category: "test",
    severity: "error",
    suggestedAction: "Fix failing tests",
  },
  {
    regex: /AssertionError:/i,
    category: "test",
    severity: "error",
    suggestedAction: "Fix test assertion",
  },

  // Python errors
  {
    regex: /Traceback \(most recent call last\)/i,
    category: "runtime",
    severity: "error",
    suggestedAction: "Fix Python error",
  },
  {
    regex: /ModuleNotFoundError:/i,
    category: "dependency",
    severity: "error",
    suggestedAction: "Install Python package",
  },
  {
    regex: /ImportError:/i,
    category: "dependency",
    severity: "error",
    suggestedAction: "Fix import error",
  },

  // Rust errors
  {
    regex: /error\[E\d+\]:/i,
    category: "build",
    severity: "error",
    suggestedAction: "Fix Rust compiler error",
  },
  {
    regex: /cargo build.*FAILED/i,
    category: "build",
    severity: "error",
    suggestedAction: "Fix build error",
  },

  // General errors
  {
    regex: /FATAL ERROR/i,
    category: "general",
    severity: "error",
    suggestedAction: "Fix fatal error",
  },
  {
    regex: /Segmentation fault/i,
    category: "runtime",
    severity: "error",
    suggestedAction: "Fix segmentation fault",
  },
  {
    regex: /Error:\s+(.+)/i,
    category: "general",
    severity: "error",
    suggestedAction: "Fix error",
  },
  {
    regex: /exit code [1-9]\d*/i,
    category: "general",
    severity: "error",
    suggestedAction: "Fix command failure",
  },

  // Warnings
  {
    regex: /warning TS\d+:/i,
    category: "build",
    severity: "warning",
    suggestedAction: "Review TypeScript warnings",
  },
  {
    regex: /DeprecationWarning:/i,
    category: "general",
    severity: "warning",
    suggestedAction: "Update deprecated API",
  },
];

export const TERMINAL_OUTPUT_CAPTURE_CHARS = 64 * 1024;

export function classifyTerminalOutput(output: string): ClassifiedTerminalError[] {
  const errors: ClassifiedTerminalError[] = [];
  const lines = output.split("\n");
  const seenPatterns = new Set<string>();

  for (const line of lines) {
    for (const pattern of ERROR_PATTERNS) {
      const match = line.match(pattern.regex);
      if (match && !seenPatterns.has(pattern.suggestedAction)) {
        seenPatterns.add(pattern.suggestedAction);
        errors.push({
          pattern: pattern.regex.source,
          matchedText: line.trim().substring(0, 200),
          category: pattern.category,
          severity: pattern.severity,
          suggestedAction: pattern.suggestedAction,
        });
        break;
      }
    }
  }

  return errors;
}

/** Kernel/QEMU builds must not get "install this npm package" suggestions. */
export function shouldOfferPackageInstall(
  category: TerminalErrorCategory,
  command?: string,
  output?: string,
): boolean {
  if (category !== "dependency") {
    return false;
  }
  const blob = `${command ?? ""}\n${output ?? ""}`;
  if (
    /(?:^|[\s;|&])(?:make|ninja|gcc|g\+\+|clang|qemu-system-)/i.test(blob) ||
    /Kconfig|Kernel panic|undefined reference|:\d+:\d+:\s+error:/i.test(blob)
  ) {
    return false;
  }
  return true;
}
