import type { CoreRuntime } from "./runtime";

export function registerTerminalHandlers(core: CoreRuntime): void {
  const on = core.messenger.on.bind(core.messenger);

  // ── Terminal Suggestion Handlers ──
  on("terminal/getSuggestions", async () => {
    try {
      const contents = await core.ide.getTerminalContents();
      if (!contents || contents.trim().length === 0) {
        return { suggestions: [] };
      }

      const errorPatterns: { pattern: RegExp; category: string }[] = [
        { pattern: /error TS\d+:/i, category: "build" },
        { pattern: /SyntaxError:/i, category: "build" },
        {
          pattern: /Cannot find module ['"][^'"]+['"]/i,
          category: "dependency",
        },
        { pattern: /Module not found/i, category: "dependency" },
        { pattern: /npm ERR!/i, category: "dependency" },
        { pattern: /FAIL\s+/i, category: "test" },
        { pattern: /AssertionError/i, category: "test" },
        { pattern: /error\[E\d+\]/i, category: "build" },
        {
          pattern: /Traceback \(most recent call last\)/i,
          category: "runtime",
        },
        { pattern: /ModuleNotFoundError:/i, category: "dependency" },
        { pattern: /FATAL ERROR/i, category: "runtime" },
      ];

      const lines = contents.split("\n");
      const suggestions: Array<{
        command: string;
        errorPattern: string;
        suggestedFix: string;
        confidence: number;
        timestamp: number;
      }> = [];

      for (const line of lines.slice(-100)) {
        for (const { pattern, category } of errorPatterns) {
          const match = line.match(pattern);
          if (match) {
            suggestions.push({
              command: line.trim().substring(0, 200),
              errorPattern: match[0],
              suggestedFix:
                category === "dependency"
                  ? "Install missing dependencies"
                  : category === "build"
                    ? "Fix the compilation error"
                    : category === "test"
                      ? "Fix the failing test"
                      : "Investigate the runtime error",
              confidence: category === "dependency" ? 0.9 : 0.7,
              timestamp: Date.now(),
            });
            break;
          }
        }
      }

      // Deduplicate by errorPattern
      const seen = new Set<string>();
      const unique = suggestions.filter((s) => {
        if (seen.has(s.errorPattern)) return false;
        seen.add(s.errorPattern);
        return true;
      });

      return { suggestions: unique.slice(0, 5) };
    } catch (e) {
      console.error("[Terminal] Failed to get suggestions:", e);
      return { suggestions: [] };
    }
  });

  on("terminal/applySuggestion", async (msg) => {
    const { command, suggestedFix } = msg.data;
    try {
      await core.ide.runCommand(suggestedFix);
      return { success: true };
    } catch {
      return { success: false };
    }
  });
}
