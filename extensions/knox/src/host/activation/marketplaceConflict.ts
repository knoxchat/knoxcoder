/** Marketplace VSIX id. Builtin in KnoxCoder is `vscode.knox`. */
export const MARKETPLACE_KNOX_ID = "knoxchat.knoxchat";
export const BUILTIN_KNOX_ID = "vscode.knox";
export const MARKETPLACE_NOTICE_STATE_KEY = "knox.marketplaceNoticeShown";

/**
 * KN-121: when KnoxCoder already has builtin Knox, the marketplace VSIX
 * must not activate — both contribute `knoxchat.knoxGUIView`.
 */
export function shouldSkipMarketplaceActivation(params: {
  thisExtensionId: string;
  builtinPresent: boolean;
}): boolean {
  return params.thisExtensionId === MARKETPLACE_KNOX_ID && params.builtinPresent;
}

/** One-time notice on the builtin: uninstall the old marketplace install. */
export function shouldShowBuiltinTakesOverNotice(params: {
  thisExtensionId: string;
  marketplacePresent: boolean;
  alreadyShown: boolean;
}): boolean {
  return (
    params.thisExtensionId === BUILTIN_KNOX_ID &&
    params.marketplacePresent &&
    !params.alreadyShown
  );
}
