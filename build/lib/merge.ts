/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Readable } from 'streamx';
import type { EventEmitter } from 'events';

type MergeableStream = EventEmitter & {
	pause?: () => void;
	resume?: () => void;
	destroy?: (err?: Error) => void;
};

/**
 * Merge multiple readable streams into one.
 *
 * Prefer this over `event-stream.merge` when working with Gulp 5 / vinyl-fs /
 * streamx. `event-stream.merge` is not a well-behaved stream under streamx and
 * can throw `TypeError: this.pipeTo.end is not a function` when a streamx
 * source ends.
 *
 * Unlike `ordered-read-streams`, this accepts event-stream through streams and
 * other stream-likes that do not expose Node's `.readable` / `.read` API.
 *
 * Data from all sources is interleaved (same as `event-stream.merge`), not
 * strictly ordered.
 */
export function merge(...streams: Array<MergeableStream | MergeableStream[]>): NodeJS.ReadWriteStream {
	const sources = streams.flat().filter((stream): stream is MergeableStream => !!stream);

	let ended = 0;
	let destroyed = false;

	const out = new Readable({
		highWaterMark: 16,
		read(this: Readable, cb: (err: Error | null) => void) {
			for (const source of sources) {
				source.resume?.();
			}
			cb(null);
		},
		predestroy() {
			destroyed = true;
			for (const source of sources) {
				source.destroy?.();
			}
		},
	});

	if (sources.length === 0) {
		queueMicrotask(() => {
			if (!destroyed) {
				out.push(null);
			}
		});
		return out as unknown as NodeJS.ReadWriteStream;
	}

	for (const source of sources) {
		// Consume via events instead of source.pipe(out). Piping a streamx
		// readable into a non-streamx writable (or vice versa) can crash with
		// `pipeTo.end is not a function` when the source ends.
		source.on('data', (chunk: unknown) => {
			if (destroyed) {
				return;
			}
			if (!out.push(chunk)) {
				source.pause?.();
			}
		});
		source.on('error', (err: Error) => {
			if (!destroyed) {
				out.destroy(err);
			}
		});
		source.on('end', () => {
			if (destroyed) {
				return;
			}
			if (++ended === sources.length) {
				out.push(null);
			}
		});
		source.resume?.();
	}

	return out as unknown as NodeJS.ReadWriteStream;
}
