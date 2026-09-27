import * as path from "node:path";

import * as glob from "glob";
import Mocha from "mocha";

export function run() {
  // Avoid timing out when stopping on breakpoints during debugging in VSCode
  const timeoutOption = process.env.MOCHA_TIMEOUT
    ? Number.parseInt(process.env.MOCHA_TIMEOUT)
    : // : undefined;
      30_000;

  // Create the mocha test
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: timeoutOption,
    grep: process.env.MOCHA_GREP,
  });

  // See esbuild.test.mjs for more details
  // Assumes this file is in out/test/runner/mochaRunner.js
  const compiledTestSuitesDirectory = path.resolve(__dirname);

  glob
    .sync("**/**.test.js", {
      cwd: compiledTestSuitesDirectory,
      ignore: "**/node_modules/**",
    })
    .forEach((file: string) => {
      mocha.addFile(path.resolve(compiledTestSuitesDirectory, file));
    });

  console.log(
    `Testing files in ${compiledTestSuitesDirectory}: ${mocha.files}`,
  );

  return new Promise<void>((resolve, reject) => {
    try {
      // Run the mocha test
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} testing failed`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error(err);
      reject(err);
    }
  });
}
