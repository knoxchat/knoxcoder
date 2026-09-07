import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// English translations
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enChat from './locales/en/chat.json';
import enHistory from './locales/en/history.json';
import enErrors from './locales/en/errors.json';
import enModels from './locales/en/models.json';
import enStats from './locales/en/stats.json';
import enTools from './locales/en/tools.json';

// Chinese translations
import zhCommon from './locales/zh/common.json';
import zhSettings from './locales/zh/settings.json';
import zhChat from './locales/zh/chat.json';
import zhHistory from './locales/zh/history.json';
import zhErrors from './locales/zh/errors.json';
import zhModels from './locales/zh/models.json';
import zhStats from './locales/zh/stats.json';
import zhTools from './locales/zh/tools.json';

// Merge all translation modules into single translation object per language
const enTranslation = {
  ...enCommon,
  ...enSettings,
  ...enChat,
  ...enHistory,
  ...enErrors,
  ...enModels,
  ...enStats,
  ...enTools,
};

const zhTranslation = {
  ...zhCommon,
  ...zhSettings,
  ...zhChat,
  ...zhHistory,
  ...zhErrors,
  ...zhModels,
  ...zhStats,
  ...zhTools,
};

const resources = {
  en: {
    translation: enTranslation
  },
  zh: {
    translation: zhTranslation
  },
};

// Supported languages
export const SUPPORTED_LANGUAGES = ['en', 'zh'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

// Default language
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

// Language display names
export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  zh: '中文',
};

// Language toggle display (what to show when switching)
export const LANGUAGE_TOGGLE_TEXT: Record<SupportedLanguage, string> = {
  en: '中', // Show Chinese character when current is English
  zh: 'EN', // Show EN when current is Chinese
};

// Initialize i18n
if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      lng: DEFAULT_LANGUAGE,
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: [...SUPPORTED_LANGUAGES],
      debug: false,
      interpolation: {
        escapeValue: false,
      },
      resources,
      react: {
        useSuspense: false,
        bindI18n: 'languageChanged',
        bindI18nStore: '',
      },
    });
}

/**
 * Apply user's preferred language from localStorage.
 */
export function applyUserLanguage(): SupportedLanguage {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;

  // Check localStorage first
  const storedLang = localStorage.getItem('i18nextLng');
  if (storedLang && SUPPORTED_LANGUAGES.includes(storedLang as SupportedLanguage)) {
    if (i18n.language !== storedLang) {
      i18n.changeLanguage(storedLang);
    }
    updateDocumentLanguage(storedLang as SupportedLanguage);
    return storedLang as SupportedLanguage;
  }

  // Fall back to browser language detection
  const browserLang = navigator.language.toLowerCase();
  const detectedLang: SupportedLanguage = browserLang.startsWith('zh') ? 'zh' : 'en';

  if (i18n.language !== detectedLang) {
    i18n.changeLanguage(detectedLang);
    localStorage.setItem('i18nextLng', detectedLang);
  }
  
  updateDocumentLanguage(detectedLang);
  return detectedLang;
}

/**
 * Update the document's lang attribute for accessibility
 */
export function updateDocumentLanguage(lang: SupportedLanguage) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }
}

/**
 * Switch language instantly with all necessary updates
 */
export function switchLanguage(lang: SupportedLanguage) {
  if (!SUPPORTED_LANGUAGES.includes(lang)) {
    console.warn(`[i18n] Unsupported language: ${lang}`);
    return;
  }

  // Change i18n language
  i18n.changeLanguage(lang);
  
  // Persist to localStorage
  if (typeof window !== 'undefined') {
    localStorage.setItem('i18nextLng', lang);
  }
  
  // Update document lang attribute
  updateDocumentLanguage(lang);
}

/**
 * Toggle between English and Chinese
 */
export function toggleLanguage(): SupportedLanguage {
  const current = i18n.language as SupportedLanguage;
  const newLang: SupportedLanguage = current === 'zh' ? 'en' : 'zh';
  switchLanguage(newLang);
  return newLang;
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

export default i18n;
