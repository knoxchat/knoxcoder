/**
 * Cross-compiler presence check (HL-35).
 * Missing aarch64-linux-gnu-gcc should be a structured error, not a 200-line make log.
 */

export const ARCH_TO_CROSS_PREFIX: Record<string, string> = {
  arm64: "aarch64-linux-gnu-",
  aarch64: "aarch64-linux-gnu-",
  arm: "arm-linux-gnueabihf-",
  riscv: "riscv64-linux-gnu-",
  riscv64: "riscv64-linux-gnu-",
  powerpc: "powerpc64le-linux-gnu-",
  ppc64: "powerpc64le-linux-gnu-",
  mips: "mips-linux-gnu-",
  loongarch: "loongarch64-linux-gnu-",
  s390: "s390x-linux-gnu-",
};

const NATIVE_ARCH = /^(x86_64|x86|i386|um|host)$/i;

export function normalizeArch(raw: string | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

export function crossPrefixForArch(arch: string): string | undefined {
  const key = normalizeArch(arch);
  return key ? ARCH_TO_CROSS_PREFIX[key] : undefined;
}

export function isNativeArch(arch: string | undefined): boolean {
  const key = normalizeArch(arch);
  return !key || NATIVE_ARCH.test(key);
}

export function gccNameForPrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (!trimmed) {
    return "gcc";
  }
  return trimmed.endsWith("-") ? `${trimmed}gcc` : `${trimmed}-gcc`;
}

export function missingCrossCompilerMessage(input: {
  arch: string;
  prefix: string;
  gcc: string;
}): string {
  return [
    `Cross compiler not found: ${input.gcc}`,
    `ARCH=${input.arch} needs CROSS_COMPILE=${input.prefix} (expected ${input.gcc} on PATH).`,
    "Install the toolchain or set env.CROSS_COMPILE to the prefix that exists.",
    "builtin_build did not start make (avoiding a long missing-compiler log).",
  ].join("\n");
}

export async function findMissingCrossCompiler(opts: {
  arch?: string;
  crossCompile?: string;
  which: (binary: string) => Promise<boolean>;
}): Promise<string | undefined> {
  const arch = normalizeArch(opts.arch);
  const explicit = (opts.crossCompile ?? "").trim();
  if (explicit) {
    const gcc = gccNameForPrefix(explicit);
    if (await opts.which(gcc)) {
      return undefined;
    }
    return missingCrossCompilerMessage({
      arch: arch || "(set)",
      prefix: explicit.endsWith("-") ? explicit : `${explicit}-`,
      gcc,
    });
  }
  if (isNativeArch(arch)) {
    return undefined;
  }
  const prefix = crossPrefixForArch(arch);
  if (!prefix) {
    return [
      `ARCH=${arch} usually needs CROSS_COMPILE, but the triple is unknown.`,
      "Set env.CROSS_COMPILE (e.g. aarch64-linux-gnu-) or install the matching gcc.",
    ].join("\n");
  }
  const gcc = gccNameForPrefix(prefix);
  if (await opts.which(gcc)) {
    return undefined;
  }
  return missingCrossCompilerMessage({ arch, prefix, gcc });
}

export async function binaryOnPath(
  subprocess: (command: string, cwd?: string) => Promise<[string, string]>,
  name: string,
): Promise<boolean> {
  const safe = name.replace(/[^A-Za-z0-9_+=@%/,.-]/g, "");
  if (!safe || safe !== name) {
    return false;
  }
  try {
    const [stdout] = await subprocess(`command -v ${safe} || true`);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
