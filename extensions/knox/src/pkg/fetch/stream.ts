export async function* toAsyncIterable(
  nodeReadable: NodeJS.ReadableStream,
): AsyncGenerator<Uint8Array> {
  for await (const chunk of nodeReadable) {
    yield chunk as Uint8Array;
  }
}

export async function* streamResponse(
  response: Response,
): AsyncGenerator<string> {
  if (response.status !== 200) {
    throw new Error(await response.text());
  }

  if (!response.body) {
    throw new Error("No response body returned.");
  }

  // Get the major version of Node.js
  const nodeMajorVersion = parseInt(process.versions.node.split(".")[0], 10);

  if (nodeMajorVersion >= 20) {
    // Use the new API for Node 20 and above
    const stream = (ReadableStream as any).from(response.body);
    for await (const chunk of stream.pipeThrough(
      new TextDecoderStream("utf-8"),
    )) {
      yield chunk;
    }
  } else {
    // Fallback for Node versions below 20
    // Streaming with this method doesn't work as version 20+ does
    const decoder = new TextDecoder("utf-8");
    const nodeStream = response.body as unknown as NodeJS.ReadableStream;
    for await (const chunk of toAsyncIterable(nodeStream)) {
      yield decoder.decode(chunk, { stream: true });
    }
  }
}

function parseDataLine(line: string): any {
  const json = line.startsWith("data: ")
    ? line.slice("data: ".length)
    : line.slice("data:".length);

  const data = JSON.parse(json);
  if (data.error) {
    throw new Error(`Error streaming response: ${data.error}`);
  }

  return data;
}

/** Parse one SSE line. Comments / pings must not end the stream. */
export function parseSseLine(line: string): { done: boolean; data: any } {
  const trimmed = line.replace(/\r$/, "");
  if (!trimmed || trimmed.startsWith(":")) {
    return { done: false, data: undefined };
  }
  if (
    trimmed.startsWith("event:") ||
    trimmed.startsWith("id:") ||
    trimmed.startsWith("retry:")
  ) {
    return { done: false, data: undefined };
  }
  if (!trimmed.startsWith("data:")) {
    return { done: false, data: undefined };
  }

  const payload = trimmed.startsWith("data: ")
    ? trimmed.slice(6)
    : trimmed.slice(5);
  if (!payload.trim() || payload.trim() === "[DONE]") {
    return { done: payload.trim() === "[DONE]", data: undefined };
  }

  try {
    return { done: false, data: parseDataLine(trimmed) };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Error streaming response")
    ) {
      throw error;
    }
    return { done: false, data: undefined };
  }
}

export async function* streamSse(response: Response): AsyncGenerator<any> {
  let buffer = "";
  for await (const value of streamResponse(response)) {
    buffer += value;

    let position: number;
    while ((position = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, position);
      buffer = buffer.slice(position + 1);

      const { done, data } = parseSseLine(line);
      if (done) {
        return;
      }
      if (data) {
        yield data;
      }
    }
  }

  if (buffer.length > 0) {
    const { done, data } = parseSseLine(buffer);
    if (!done && data) {
      yield data;
    }
  }
}

export async function* streamJSON(response: Response): AsyncGenerator<any> {
  let buffer = "";
  for await (const value of streamResponse(response)) {
    buffer += value;

    let position;
    while ((position = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, position);
      const data = JSON.parse(line);
      yield data;
      buffer = buffer.slice(position + 1);
    }
  }
}
