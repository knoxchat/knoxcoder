import * as assert from "node:assert";

import {
  collectConfigYamlUsesLinks,
  CONFIG_YAML_LANGUAGE,
  CONFIG_YAML_USES_HREF_BASE,
  CONFIG_YAML_WATCH_INTERVAL_MS,
  isKnoxConfigYamlPath,
  parseConfigYamlUsesLink,
  pathsReferToSameFile,
  shouldReloadConfigFromWatch,
  watchConfigYamlFile,
} from "./configYaml";

suite("KN-356 config.yaml watcher + document links", () => {
  test("watch interval and yaml language stay stable", () => {
    assert.strictEqual(CONFIG_YAML_WATCH_INTERVAL_MS, 1000);
    assert.strictEqual(CONFIG_YAML_LANGUAGE, "yaml");
    assert.strictEqual(CONFIG_YAML_USES_HREF_BASE, "https://knox.chat/");
  });

  test("empty watch stats skip reload; config.yaml path matches", () => {
    assert.strictEqual(shouldReloadConfigFromWatch({ size: 0 }), false);
    assert.strictEqual(shouldReloadConfigFromWatch({ size: 12 }), true);
    assert.strictEqual(isKnoxConfigYamlPath("/Users/me/.knoxcoder/config.yaml"), true);
    assert.strictEqual(isKnoxConfigYamlPath("C:\\Users\\me\\.knoxcoder\\config.yml"), true);
    assert.strictEqual(isKnoxConfigYamlPath("/tmp/other.yaml"), false);
    assert.ok(pathsReferToSameFile("/tmp/config.yaml", "/tmp/config.yaml"));
    assert.ok(pathsReferToSameFile("/tmp/config.yaml/", "/tmp/config.yaml"));
  });

  test("uses: slugs become knox.chat document links", () => {
    assert.strictEqual(parseConfigYamlUsesLink("models:"), undefined);
    assert.strictEqual(parseConfigYamlUsesLink("  - uses:   "), undefined);
    assert.deepStrictEqual(parseConfigYamlUsesLink("  - uses: acme/tools"), {
      slug: "acme/tools",
      start: 10,
      end: 20,
      href: "https://knox.chat/acme/tools",
    });
    const commented = parseConfigYamlUsesLink("  # - uses: acme/tools");
    assert.strictEqual(commented?.slug, "acme/tools");
    assert.deepStrictEqual(
      collectConfigYamlUsesLinks([
        "name: Knox",
        "  - uses: acme/tools",
        "  - uses: other/block",
      ]).map((link) => link.slug),
      ["acme/tools", "other/block"],
    );
  });

  test("watchConfigYamlFile unwatches on dispose and skips size 0", async () => {
    const watched: string[] = [];
    const unwatched: string[] = [];
    let changes = 0;
    let listener: ((stats: { size: number }) => void) | undefined;
    const disposable = watchConfigYamlFile(
      "/tmp/.knoxcoder/config.yaml",
      (_filename, options, next) => {
        assert.strictEqual(options.interval, 1000);
        watched.push(_filename);
        listener = next;
      },
      (filename) => {
        unwatched.push(filename);
      },
      () => {
        changes += 1;
      },
    );
    assert.deepStrictEqual(watched, ["/tmp/.knoxcoder/config.yaml"]);
    listener?.({ size: 0 });
    listener?.({ size: 8 });
    await Promise.resolve();
    assert.strictEqual(changes, 1);
    disposable.dispose();
    assert.deepStrictEqual(unwatched, ["/tmp/.knoxcoder/config.yaml"]);
  });
});
