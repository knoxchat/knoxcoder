import fs from "fs";

/**
 * Write a file so a crash or kill at any point leaves either the old or the new
 * content, never a truncated file: write to a temp sibling, fsync, then rename.
 */
export function writeFileAtomic(filepath: string, data: string, mode?: number): void {
  const tmp = `${filepath}.${process.pid}.${Date.now()}.tmp`;
  let fd: number | undefined;
  try {
    fd = mode === undefined ? fs.openSync(tmp, "w") : fs.openSync(tmp, "w", mode);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, filepath);
  } catch (e) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw e;
  }
}
