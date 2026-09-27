/**
 * Lightweight leveled logger for Core / VS Code / GUI.
 *
 * Levels: debug < info < warn < error
 *
 * Default minimum level:
 * - production or IS_BINARY → warn (quiet)
 * - otherwise → info
 *
 * Override with KNOX_LOG_LEVEL=debug|info|warn|error
 */

export type KnoxLogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<KnoxLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function getKnoxLogLevel(): KnoxLogLevel {
  const raw =
    typeof process !== "undefined"
      ? process.env?.KNOX_LOG_LEVEL?.toLowerCase()
      : undefined;
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }

  const nodeEnv =
    typeof process !== "undefined" ? process.env?.NODE_ENV : undefined;
  const isBinary =
    typeof process !== "undefined" && process.env?.IS_BINARY === "true";

  if (nodeEnv === "production" || isBinary) {
    return "warn";
  }
  return "info";
}

export type KnoxLogger = {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
};

export function createKnoxLogger(scope: string): KnoxLogger {
  const emit = (level: KnoxLogLevel, message: string, ...args: unknown[]) => {
    if (ORDER[level] < ORDER[getKnoxLogLevel()]) {
      return;
    }
    const line = `[${scope}] ${message}`;
    switch (level) {
      case "debug":
        console.debug(line, ...args);
        break;
      case "info":
        console.log(line, ...args);
        break;
      case "warn":
        console.warn(line, ...args);
        break;
      case "error":
        console.error(line, ...args);
        break;
    }
  };

  return {
    debug: (message, ...args) => emit("debug", message, ...args),
    info: (message, ...args) => emit("info", message, ...args),
    warn: (message, ...args) => emit("warn", message, ...args),
    error: (message, ...args) => emit("error", message, ...args),
  };
}
