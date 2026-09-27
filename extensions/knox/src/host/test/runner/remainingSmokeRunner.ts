import * as path from "node:path";

import Mocha from "mocha";

export function run() {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: Number.parseInt(process.env.MOCHA_TIMEOUT ?? "120000", 10),
    grep: process.env.MOCHA_GREP,
  });

  mocha.addFile(
    path.resolve(__dirname, "../../nativeParity/desktopRemainingSmoke.test.js"),
  );

  return new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} remaining smoke tests failed`));
      } else {
        resolve();
      }
    });
  });
}
