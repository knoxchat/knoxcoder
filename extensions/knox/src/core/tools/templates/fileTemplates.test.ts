import { describe, expect, it } from "vitest";

import {
  RUST_DEFAULT_EDITION,
  RUST_DEFAULT_VERSION,
} from "../../context/rustDefaults";
import {
  detectLanguageFromExtension,
  detectTemplateFromExtension,
  getTemplate,
} from "./fileTemplates";

describe("rust-module template", () => {
  it("emits a compiling unit struct with Default and cfg(test)", () => {
    const text = getTemplate("rust-module", "src/widget.rs");
    expect(text).toContain("#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]");
    expect(text).toContain("pub struct Widget;");
    expect(text).toContain("#[cfg(test)]");
    expect(text).toContain("Widget::default()");
    expect(text).not.toMatch(/Add your fields/);
  });
});

describe("new rust crate templates", () => {
  it("writes Cargo.toml with edition 2024 and rust-version 1.98.1", () => {
    const text = getTemplate("rust-cargo-toml", "snake/Cargo.toml");
    expect(text).toContain('name = "snake"');
    expect(text).toContain(`edition = "${RUST_DEFAULT_EDITION}"`);
    expect(text).toContain(`rust-version = "${RUST_DEFAULT_VERSION}"`);
    expect(text).not.toContain('edition = "2021"');
  });

  it("pins rust-toolchain.toml to 1.98.1", () => {
    const text = getTemplate("rust-toolchain", "rust-toolchain.toml");
    expect(text).toContain(`channel = "${RUST_DEFAULT_VERSION}"`);
  });

  it("auto-detects new-project rust files", () => {
    expect(detectTemplateFromExtension("snake/Cargo.toml")).toBe(
      "rust-cargo-toml",
    );
    expect(detectTemplateFromExtension("rust-toolchain.toml")).toBe(
      "rust-toolchain",
    );
    expect(detectTemplateFromExtension("src/main.rs")).toBe("rust-bin");
    expect(detectTemplateFromExtension("src/lib.rs")).toBe("rust-lib");
    expect(detectTemplateFromExtension("src/widget.rs")).toBe("rust-module");
  });

  it("labels Cargo.toml as toml", () => {
    expect(detectLanguageFromExtension("Cargo.toml")).toBe("toml");
  });
});
