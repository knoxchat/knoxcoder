import type { Duplex } from 'stream';

declare global {
	namespace NodeJS {
		// Gulp/event-stream use Node.js stream.Duplex, not the Web Streams API types.
		interface ReadWriteStream extends Duplex {
			compose<T extends NodeJS.ReadableStream>(
				stream: T | ComposeFnParam | Iterable<T> | AsyncIterable<T>,
				options?: { signal: AbortSignal },
			): T;
		}
	}
}

declare namespace NodeJS {
	type ComposeFnParam = (source: any) => void;
}
