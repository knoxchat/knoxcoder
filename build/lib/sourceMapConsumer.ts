/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SourceMapConsumer, type RawSourceMap } from 'source-map';

/**
 * VS Code 1.141 pins `source-map@0.6.1`: the consumer is synchronous and has
 * neither `destroy()` nor `SourceMapConsumer.with()`. source-map >= 0.7 is
 * async, WASM-backed, and must be disposed via `destroy()` or `.with()`.
 *
 * Use this helper from minify/NLS/tsb so both APIs work after an upstream pin change.
 */
export async function withSourceMapConsumer<T>(
	rawSourceMap: RawSourceMap,
	callback: (consumer: SourceMapConsumer) => T | Promise<T>
): Promise<T> {
	const withFn = Reflect.get(SourceMapConsumer, 'with');
	if (typeof withFn === 'function') {
		return await withFn.call(SourceMapConsumer, rawSourceMap, null, callback);
	}

	const consumer = await new SourceMapConsumer(rawSourceMap);
	try {
		return await callback(consumer);
	} finally {
		const destroy = Reflect.get(consumer, 'destroy');
		if (typeof destroy === 'function') {
			destroy.call(consumer);
		}
	}
}
