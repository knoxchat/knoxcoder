---
name: gdb
description: GDB / kgdb / QEMU gdbstub (-s -S) for kernel debugging. Use when attaching to qemu-system, kgdb, or reading a backtrace.
---

# GDB / kgdb

Knox has `builtin_debug` (DAP: launch/attach/breakpoint/continue/step/backtrace) when a VS Code session exists or the systems profile is on. PTY gdb still works for qemu-system without DAP.

## QEMU gdbstub

1. `builtin_qemu` start with `gdb=true` (adds `-s -S`; QEMU waits).
2. `builtin_pty_start` command=`gdb vmlinux` (or `gdb ./qemu-system-x86_64` for userland).
3. `builtin_pty_send` `target remote :1234\n`
4. Break / continue / `bt` via send/read. Timeout is per-read.

## kgdb

Boot with `kgdboc=ttyS0,115200 kgdbwait` in `-append`, then `target remote` on the serial PTY. Do not assume a second UART unless the user configured one.

## Don't

- Don't paste entire `info registers` dumps into the plan; keep RIP + `bt` frames.
- Don't `continue` forever without a `builtin_pty_read` wait.
