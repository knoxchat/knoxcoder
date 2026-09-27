/**
 * Browser-safe Soul helpers. Node-only persistence lives in
 * `./recordSoulEvent.js` — do not re-export it here. The GUI imports this
 * barrel; pulling BrainManager/sqlite3 into the webview crashes launch.
 */
export type { SoulEvent, SoulEventKind, SoulToolContext } from "./types.js";
export {
  extractSoulCheckpointId,
  extractSoulFiles,
  formatLinkedRestoreOffer,
  formatRestoreNotice,
  formatSettledToolSummary,
  formatSoulCheckpointStamp,
  formatSoulEventContent,
} from "./extractToolFiles.js";
export {
  isMemoryReadAction,
  memoryWriteBlockedMessage,
} from "./memoryAccess.js";
