import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
} from "../../index.js";
import { listShellJobs } from "../../tools/shellJobs";
import { BaseContextProvider } from "../index.js";
import {
  loadSerialContextFromJobs,
  SERIAL_CONTEXT_MARKER,
} from "../serialContext";

class SerialContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "serial",
    displayTitle: "Serial",
    description: "Last QEMU / PTY / serial job log lines",
    type: "normal",
  };

  async getContextItems(
    _query: string,
    _extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    const content = loadSerialContextFromJobs(listShellJobs());
    return [
      {
        name: SERIAL_CONTEXT_MARKER,
        description: "QEMU/PTY job artifact tail",
        content:
          content ||
          "No QEMU/PTY job logs. Start with builtin_qemu or builtin_pty_start; serial is the job log.",
      },
    ];
  }
}

export default SerialContextProvider;
