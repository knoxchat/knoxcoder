/**
 * Run FromWebview handlers for one incoming message.
 *
 * `VsCodeWebviewProtocol.on` stacks handlers (chat messenger + checkpoint graph
 * both register restore/list/…). Streaming `llm/streamChat` through every
 * handler with the same messageId triples each token in the native GUI.
 * The first handler that returns a value or async iterator owns the reply;
 * later handlers are skipped. Side-effect handlers that return `undefined`
 * still run until one responds.
 */

export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { [Symbol.asyncIterator]?: unknown })[
        Symbol.asyncIterator
      ] === "function",
  );
}

export type ProtocolDispatchResult =
  | { kind: "empty" }
  | { kind: "value" }
  | { kind: "stream" }
  | { kind: "error"; error: Error };

export async function dispatchProtocolHandlers<TMsg>(
  handlers: ReadonlyArray<(msg: TMsg) => unknown>,
  msg: TMsg,
  respond: (payload: unknown) => void,
): Promise<ProtocolDispatchResult> {
  if (handlers.length === 0) {
    return { kind: "empty" };
  }
  for (const handler of handlers) {
    try {
      const response = await handler(msg);
      if (isAsyncIterable(response)) {
        const iterator = response[Symbol.asyncIterator]();
        let next = await iterator.next();
        while (!next.done) {
          respond({
            done: false,
            content: next.value,
            status: "success",
          });
          next = await iterator.next();
        }
        respond({
          done: true,
          content: next.value,
          status: "success",
        });
        return { kind: "stream" };
      }
      if (response !== undefined) {
        respond({ done: true, content: response, status: "success" });
        return { kind: "value" };
      }
    } catch (e) {
      return {
        kind: "error",
        error: e instanceof Error ? e : new Error(String(e)),
      };
    }
  }
  respond({ done: true, content: undefined, status: "success" });
  return { kind: "value" };
}
