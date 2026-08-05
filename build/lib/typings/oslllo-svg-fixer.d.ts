/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'oslllo-svg-fixer' {
	interface SVGFixerOptions {
		showProgressBar?: boolean;
		throwIfEmpty?: boolean;
		traceResolution?: number;
	}

	interface SVGFixerInstance {
		fix(): Promise<void>;
	}

	function SVGFixer(source: string, destination: string, options?: SVGFixerOptions): SVGFixerInstance;

	export default SVGFixer;
}
