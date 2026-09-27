import * as assert from "node:assert";

import {
  BUILTIN_KNOX_ID,
  MARKETPLACE_KNOX_ID,
  shouldShowBuiltinTakesOverNotice,
  shouldSkipMarketplaceActivation,
} from "./marketplaceConflict";

suite("marketplaceConflict (KN-121)", () => {
  test("skips knoxchat.knoxchat when vscode.knox is present", () => {
    assert.strictEqual(
      shouldSkipMarketplaceActivation({
        thisExtensionId: MARKETPLACE_KNOX_ID,
        builtinPresent: true,
      }),
      true,
    );
  });

  test("does not skip marketplace Knox on stock VS Code", () => {
    assert.strictEqual(
      shouldSkipMarketplaceActivation({
        thisExtensionId: MARKETPLACE_KNOX_ID,
        builtinPresent: false,
      }),
      false,
    );
  });

  test("builtin never skips itself", () => {
    assert.strictEqual(
      shouldSkipMarketplaceActivation({
        thisExtensionId: BUILTIN_KNOX_ID,
        builtinPresent: true,
      }),
      false,
    );
  });

  test("shows the uninstall notice once on the builtin", () => {
    assert.strictEqual(
      shouldShowBuiltinTakesOverNotice({
        thisExtensionId: BUILTIN_KNOX_ID,
        marketplacePresent: true,
        alreadyShown: false,
      }),
      true,
    );
    assert.strictEqual(
      shouldShowBuiltinTakesOverNotice({
        thisExtensionId: BUILTIN_KNOX_ID,
        marketplacePresent: true,
        alreadyShown: true,
      }),
      false,
    );
    assert.strictEqual(
      shouldShowBuiltinTakesOverNotice({
        thisExtensionId: MARKETPLACE_KNOX_ID,
        marketplacePresent: true,
        alreadyShown: false,
      }),
      false,
    );
  });
});
