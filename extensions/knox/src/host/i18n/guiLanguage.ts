import * as vscode from "vscode";

import {
  SUPPORTED_LANGUAGES,
  getCurrentLanguage,
  switchLanguage,
  type SupportedLanguage,
} from "./index";

const STORAGE_KEY = "knox.guiLanguage";

let storage: vscode.Memento | undefined;
const changed = new vscode.EventEmitter<SupportedLanguage>();

/** Fires after the sidebar Settings language changes. */
export const onGuiLanguageChanged = changed.event;

function isSupported(value: unknown): value is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(value as SupportedLanguage);
}

/**
 * The sidebar stores its language in webview localStorage, which other
 * webviews cannot read. The last reported value lives in globalState so
 * host strings and editor panels follow it from activation on.
 * KN-381: switchLanguage also updates core/i18n so tool/error catalogs match.
 */
export function initGuiLanguage(state: vscode.Memento): void {
  storage = state;
  const stored = state.get<string>(STORAGE_KEY);
  if (isSupported(stored)) {
    switchLanguage(stored);
  }
}

export function getGuiLanguage(): SupportedLanguage {
  const stored = storage?.get<string>(STORAGE_KEY);
  return isSupported(stored) ? stored : getCurrentLanguage();
}

export function setGuiLanguage(language: string): void {
  if (!isSupported(language)) {
    return;
  }
  const previous = storage?.get<string>(STORAGE_KEY);
  const hostChanged = getCurrentLanguage() !== language;
  if (hostChanged) {
    switchLanguage(language);
  }
  if (previous !== language) {
    void storage?.update(STORAGE_KEY, language);
  }
  if (hostChanged || previous !== language) {
    changed.fire(language);
  }
}
