import i18n from "i18next";

// English translations
import enExtension from "./locales/en/extension.json";
import enAgent from "./locales/en/agent.json";
import enCommands from "./locales/en/commands.json";
import enCheckpoints from "./locales/en/checkpoints.json";
import enHistory from "./locales/en/history.json";
import enDiff from "./locales/en/diff.json";
import enUi from "./locales/en/ui.json";

// Chinese translations
import zhExtension from "./locales/zh/extension.json";
import zhAgent from "./locales/zh/agent.json";
import zhCommands from "./locales/zh/commands.json";
import zhCheckpoints from "./locales/zh/checkpoints.json";
import zhHistory from "./locales/zh/history.json";
import zhDiff from "./locales/zh/diff.json";
import zhUi from "./locales/zh/ui.json";

// Merge all translation modules into single translation object per language
const enTranslation = {
  ...enExtension,
  ...enAgent,
  ...enCommands,
  ...enCheckpoints,
  ...enHistory,
  ...enDiff,
  ...enUi,
};

const zhTranslation = {
  ...zhExtension,
  ...zhAgent,
  ...zhCommands,
  ...zhCheckpoints,
  ...zhHistory,
  ...zhDiff,
  ...zhUi,
};

const resources = {
  en: {
    translation: enTranslation,
  },
  zh: {
    translation: zhTranslation,
  },
};

// Supported languages
export const SUPPORTED_LANGUAGES = ["en", "zh"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// Default language
export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

// Language display names
export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: "English",
  zh: "中文",
};

// Initialize i18n for VS Code extension (Node.js environment, no React)
if (!i18n.isInitialized) {
  i18n.init({
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    debug: false,
    interpolation: {
      escapeValue: false,
    },
    resources,
  });
}

/**
 * Switch to a different language
 */
export function switchLanguage(lang: SupportedLanguage): void {
  if (!SUPPORTED_LANGUAGES.includes(lang)) {
    console.warn(`[vscode-i18n] Unsupported language: ${lang}`);
    return;
  }
  i18n.changeLanguage(lang);
}

/**
 * Get the current language
 */
export function getCurrentLanguage(): SupportedLanguage {
  const lang = i18n.language;
  if (SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage)) {
    return lang as SupportedLanguage;
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Detect user's preferred language from VS Code settings or environment
 */
export function detectAndApplyLanguage(): SupportedLanguage {
  try {
    // Try to detect from VS Code's locale
    const vscodeLocale =
      JSON.parse(process.env.VSCODE_NLS_CONFIG || "{}").locale || "en";
    const detectedLang: SupportedLanguage = vscodeLocale.startsWith("zh")
      ? "zh"
      : "en";

    if (i18n.language !== detectedLang) {
      i18n.changeLanguage(detectedLang);
    }

    return detectedLang;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/**
 * Translation function shorthand.
 * Usage: t("key") or t("key", { param: "value" })
 */
export const t = i18n.t.bind(i18n);

export default i18n;
