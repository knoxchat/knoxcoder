---
name: qemu
description: QEMU session recipe — qemu-system-* kernel/initrd, serial stdio, gdbstub -s -S, guest panic. Use when booting a kernel in QEMU or capturing serial/oops.
---

# QEMU (Knox recipe)

Do not embed a QEMU binary. The `qemu-system-*` on PATH is the guest.

## Start (preferred)

`builtin_qemu` action=start:

- `kernel` — bzImage / Image / vmlinux
- `initrd` — optional
- `arch` — default `x86_64` → `qemu-system-x86_64`
- `gdb=true` — add `-s -S` (wait for gdb on :1234)
- `memory` — e.g. `512M`
- `extra_args` — extra argv after the recipe

Recorded argv always includes `-serial stdio -display none -nographic`. Serial is the job log (`Job:` / `Full log:`). Pass `monitor=true` to put the QEMU human monitor on stdio and guest serial in a file under the jobs log dir.

Then:

- `builtin_qemu` action=monitor `job_id=` `command="info status"` (or `info registers`, `x/i $pc`) — lite parser prepends VM status / RIP.
- `builtin_pty_send` / `builtin_pty_read` for the guest console (timeout is per-read).
- `builtin_qemu` action=status `job_id=` to wait for serial (oops parser prepends RIP / Call Trace on panic).
- `builtin_qemu` action=stop to SIGTERM the process group.

Equivalent PTY: `builtin_pty_start` with the same command line if you already have a full argv.

## Typical x86_64 kernel

```
qemu-system-x86_64 -kernel arch/x86/boot/bzImage -initrd initramfs.cpio \
  -append "console=ttyS0 earlyprintk=serial" \
  -serial stdio -display none -nographic -s -S
```

Pass the `-append` via `extra_args`.

## Diagnose

- Kernel panic / Oops / KASAN in serial → structured frames (RIP, file:line).
- gdb: `target remote :1234` after `gdb=true` start (see skill `gdb`).
- Subsystem owners: `builtin_maintainers` lookup (QEMU has a MAINTAINERS file too).
