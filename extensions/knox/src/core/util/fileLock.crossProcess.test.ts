import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("withFileLock across real processes", () => {
  let dir: string;
  let worker: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "knox-lock-xproc-"));
    worker = path.join(dir, "worker.cjs");
    await build({
      entryPoints: [path.join(here, "testWorkers/fileLockWorker.ts")],
      outfile: worker,
      bundle: true,
      platform: "node",
      format: "cjs",
      logLevel: "silent",
    });
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function run(mode: "none" | "sync" | "async", procs: number, iterations: number): Promise<number> {
    const counter = path.join(dir, `counter-${mode}.txt`);
    await fs.writeFile(counter, "0");
    const lock = path.join(dir, `lock-${mode}`);
    await Promise.all(
      Array.from(
        { length: procs },
        () =>
          new Promise<void>((resolve, reject) => {
            const child = spawn(process.execPath, [worker, mode, lock, counter, String(iterations)], {
              stdio: ["ignore", "ignore", "pipe"],
            });
            let err = "";
            child.stderr.on("data", (d) => (err += d));
            child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker ${mode} exited ${code}: ${err}`))));
          }),
      ),
    );
    return Number(await fs.readFile(counter, "utf8"));
  }

  it("control: without the lock, concurrent processes lose updates", async () => {
    expect(await run("none", 4, 15)).toBeLessThan(60);
  }, 60_000);

  it("async lock: no lost updates across 4 processes", async () => {
    expect(await run("async", 4, 15)).toBe(60);
  }, 60_000);

  it("sync lock: no lost updates across 4 processes", async () => {
    expect(await run("sync", 4, 15)).toBe(60);
  }, 60_000);

  it("a SIGKILLed holder does not wedge the lock", async () => {
    const lock = path.join(dir, "lock-kill");
    const holderScript = path.join(dir, "holder.cjs");
    await fs.writeFile(
      holderScript,
      `const fs=require("fs"),os=require("os"),path=require("path");
       const lock=process.argv[2];fs.mkdirSync(lock);
       fs.writeFileSync(path.join(lock,"owner.json"),JSON.stringify({pid:process.pid,host:os.hostname(),token:"t",acquiredAt:Date.now()}));
       console.log("held");setInterval(()=>{},1000);`,
    );
    const holder = spawn(process.execPath, [holderScript, lock], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve) => holder.stdout.once("data", () => resolve()));
    holder.kill("SIGKILL");
    await new Promise((r) => holder.once("exit", r));

    const { withFileLock } = await import("./fileLock");
    await expect(withFileLock(lock, async () => "ok", { timeoutMs: 3000 })).resolves.toBe("ok");
  }, 30_000);
});
