---
name: linux-kernel
description: Linux kernel development — Kbuild, boot, panic/oops in mm, vmlinux, modules, kselftest, sparse/smatch. Use when building Linux, diagnosing a kernel oops or boot panic, or editing Kconfig/Makefile.
---

# Linux kernel

You are working in a kernel tree (`Kconfig` + `arch/` + `Makefile`). Prefer Knox systems tools over shell git/make.

## Build

- Incremental: `builtin_build` (or `make -j$(nproc)` via the compile oracle). Pass `env` `ARCH` / `CROSS_COMPILE` when needed.
- **Never** `make mrproper`, `make distclean`, or `make clean` unless the user asked. That wipes `.config`.
- First-time clangd: generate `compile_commands.json` once (`bear -- make` or `scripts/clang-tools`), then `builtin_lsp`. Do not invent include paths.
- Tags fallback: `make tags` then `builtin_lsp` workspaceSymbol (ctags) if clangd is empty.

## Search

- Always scope: `builtin_exact_search` with `path` (`mm/`, `fs/`, `arch/x86`) and `fileType` (`c`, `asm`, `kconfig`).
- `builtin_view_repo_map` with `path: "mm/"` instead of dumping `drivers/`.
- Who owns a file: `builtin_maintainers` lookup `path=mm/filemap.c`. Do not dump `MAINTAINERS`.
- Blame a line: `builtin_git_blame` with `start_line`/`end_line`. Pickaxe a regression string: `builtin_git_log` `search=`.
- Regressions: `builtin_git_bisect` start (good + bad) then `run` with the verify command. Always `reset` when done. Never force.

## Boot / panic

- QEMU recipe: load skill `qemu` or `builtin_qemu` start (`kernel=arch/x86/boot/bzImage`, serial stdio, optional `gdb=true` for `-s -S`).
- Serial is the job log. `builtin_pty_send` / `builtin_pty_read` for the monitor. Parsed oops (RIP, Call Trace) is prepended when panic/KASAN hits the log.
- kselftest: `make -C tools/testing/selftests TARGETS=…`.
- Static analysis: `make C=1` (sparse) or `make CHECK=smatch C=1` on the files you touched. Do not run either over the whole tree.

## Don't

- Don't snapshot `vmlinux`, `*.ko`, `*.o` in checkpoints.
- Don't suggest `npm install` for a gcc error.
