---
name: kbuild
description: Kbuild / Make / Ninja for Linux and QEMU. Incremental make, parsed gcc errors, never mrproper. Use when compiling the kernel or a QEMU meson tree.
---

# Kbuild / Make

- Compile oracle: `builtin_build` (make or ninja). Parsed gcc/clang/ld errors, not a 200KB CC log.
- `jobs`, `target`, `cwd`, `extraArgs`, `env` (`ARCH`, `CROSS_COMPILE`).
- Refuses `clean` / `mrproper` / `distclean`.
- Long builds background immediately; poll with `builtin_await_shell` (10 min slices, `errors_only`, `tail_lines`).
- Post-edit: set `knoxchat.verifyCommand` (systems profile defaults to `make`) so edits run the compile oracle instead of LSP.

## Kernel

```
make ARCH=x86_64 -j$(nproc)
```

`.config` `CONFIG_X86_64=y` implies `ARCH=x86_64`. Do not dump the whole `.config`; use `builtin_kconfig` (`get` / `search` / `list`) or `rg ^CONFIG_FOO` / `scripts/config`.

## QEMU

Out-of-tree meson: `ninja -C build` (or `builtin_build` when `build.ninja` exists). In-tree `./configure` is a long job — await it.
