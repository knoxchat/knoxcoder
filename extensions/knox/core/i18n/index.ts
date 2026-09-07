import i18n from "i18next";

// English translations
import enCore from "./locales/en/core.json";
import enCommands from "./locales/en/commands.json";
import enTools from "./locales/en/tools.json";
import enConfig from "./locales/en/config.json";
import enErrors from "./locales/en/errors.json";
import enProviders from "./locales/en/providers.json";
import enImplementations from "./locales/en/implementations.json";

// Chinese translations
import zhCore from "./locales/zh/core.json";
import zhCommands from "./locales/zh/commands.json";
import zhTools from "./locales/zh/tools.json";
import zhConfig from "./locales/zh/config.json";
import zhErrors from "./locales/zh/errors.json";
import zhProviders from "./locales/zh/providers.json";
import zhImplementations from "./locales/zh/implementations.json";

// Merge all translation modules into single translation object per language
const enTranslation = {
  ...enCore,
  ...enCommands,
  ...enTools,
  ...enConfig,
  ...enErrors,
  ...enProviders,
  ...enImplementations,
};

const zhTranslation = {
  ...zhCore,
  ...zhCommands,
  ...zhTools,
  ...zhConfig,
  ...zhErrors,
  ...zhProviders,
  ...zhImplementations,
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

// Initialize i18n (for Node.js backend - no React plugin needed)
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
    console.warn(`[core-i18n] Unsupported language: ${lang}`);
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
 * Translation function shorthand.
 * Usage: t("key") or t("key", { param: "value" })
 */
export const t = i18n.t.bind(i18n);

export default i18n;
