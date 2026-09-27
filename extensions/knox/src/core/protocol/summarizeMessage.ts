const MAX_STRING = 400;
const MAX_DEPTH = 2;
const MAX_ARRAY = 3;
const MAX_KEYS = 20;

/** Cap a protocol payload so error logs stay O(1) (CSLD-22). */
export function summarizeProtocolPayload(data: unknown, depth = 0): unknown {
  if (data == null) {
    return data;
  }
  if (typeof data === "string") {
    if (data.length <= MAX_STRING) {
      return data;
    }
    return `${data.slice(0, MAX_STRING)}…[${data.length} chars]`;
  }
  if (typeof data === "number" || typeof data === "boolean") {
    return data;
  }
  if (Array.isArray(data)) {
    if (depth >= MAX_DEPTH) {
      return `Array(${data.length})`;
    }
    const head = data
      .slice(0, MAX_ARRAY)
      .map((item) => summarizeProtocolPayload(item, depth + 1));
    if (data.length > MAX_ARRAY) {
      head.push(`…+${data.length - MAX_ARRAY}`);
    }
    return head;
  }
  if (typeof data === "object") {
    const keys = Object.keys(data as object);
    if (depth >= MAX_DEPTH) {
      return `{${keys.length} keys}`;
    }
    const out: Record<string, unknown> = {};
    for (const key of keys.slice(0, MAX_KEYS)) {
      out[key] = summarizeProtocolPayload(
        (data as Record<string, unknown>)[key],
        depth + 1,
      );
    }
    if (keys.length > MAX_KEYS) {
      out["…"] = `+${keys.length - MAX_KEYS} keys`;
    }
    return out;
  }
  return String(data);
}

export function summarizeProtocolMessage(msg: unknown): string {
  if (!msg || typeof msg !== "object") {
    return String(msg);
  }
  const m = msg as {
    messageType?: unknown;
    messageId?: unknown;
    data?: unknown;
  };
  try {
    return JSON.stringify({
      messageType: m.messageType,
      messageId: m.messageId,
      data: summarizeProtocolPayload(m.data),
    });
  } catch {
    return `[unserializable message type=${String(m.messageType)}]`;
  }
}
