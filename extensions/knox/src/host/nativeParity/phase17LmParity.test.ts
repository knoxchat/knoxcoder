import * as assert from "node:assert";

import { requireKnoxHostExtension } from "../util/knoxHostExtension";

suite("Phase 17 LM + workbench entry (KN-170–174, KN-362, KN-363, KN-365)", () => {
  test("contributes LM tools, assist provider, and inline-completion setting (default off)", () => {
    const extension = requireKnoxHostExtension();
    const contributes = extension.packageJSON?.contributes ?? {};
    const tools = (contributes.textModelApiTools ?? []) as Array<{ name: string }>;
    assert.ok(
      tools.some((tool) => tool.name === "builtin_read_file"),
      "textModelApiTools includes builtin_read_file",
    );
    const providers = (contributes.textModelApiAssistProviders ?? []) as Array<{
      vendor: string;
    }>;
    assert.ok(
      providers.some((provider) => provider.vendor === "knox"),
      "textModelApiAssistProviders vendor knox",
    );
    const inline = contributes.configuration?.properties?.[
      "knoxchat.enableInlineCompletions"
    ] as { default?: unknown } | undefined;
    assert.ok(inline, "knoxchat.enableInlineCompletions setting");
    assert.strictEqual(inline.default, false);
  });

  test("Remote-SSH: ui+workspace, no browser field (KN-365)", () => {
    const extension = requireKnoxHostExtension();
    const pkg = extension.packageJSON as {
      browser?: string;
      extensionKind?: string[];
      main?: string;
    };
    assert.strictEqual(pkg.browser, undefined);
    assert.ok(pkg.main?.includes("extension"));
    assert.deepStrictEqual(pkg.extensionKind, ["ui", "workspace"]);
  });
});
