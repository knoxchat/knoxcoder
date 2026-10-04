/**
 * Child-process worker for fileLock.crossProcess.test.ts. Bundled with esbuild
 * and run with node. Performs an intentionally non-atomic read-modify-write
 * on a counter file; only the lock keeps concurrent workers from losing updates.
 */
import fs from "node:fs";
import { withFileLock, withFileLockSync } from "../fileLock";

const [mode, lockPath, counterPath, iterations] = process.argv.slice(2);
const n = Number(iterations);

function bump(): void {
  const current = Number(fs.readFileSync(counterPath, "utf8"));
  // Widen the race window so an unlocked run reliably loses updates.
  const until = Date.now() + 3;
  while (Date.now() < until) {}
  fs.writeFileSync(counterPath, String(current + 1));
}

async function main(): Promise<void> {
  for (let i = 0; i < n; i++) {
    if (mode === "sync") {
      withFileLockSync(lockPath, bump);
    } else if (mode === "async") {
      await withFileLock(lockPath, async () => bump());
    } else {
      bump(); // "none": proves the test would catch a missing lock
    }
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
