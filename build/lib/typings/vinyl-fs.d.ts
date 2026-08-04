/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export {};

declare module 'vinyl-fs' {
	interface SrcOptions {
		encoding?: string | false;
		silent?: boolean;
		follow?: boolean;
	}

	interface DestOptions {
		encoding?: string | false;
	}
}

declare module 'glob-stream' {
	interface Options {
		follow?: boolean;
		silent?: boolean;
	}
}
