/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export {};

declare module 'gulp-rename' {
	import File = require('vinyl');

	namespace rename {
		interface ParsedPath {
			dirname: string;
			basename: string;
			extname: string;
		}

		interface Options {
			dirname?: string | undefined;
			basename?: string | undefined;
			extname?: string | undefined;
			prefix?: string | undefined;
			suffix?: string | undefined;
		}

		interface PluginOptions {
			multiExt?: boolean | undefined;
		}
	}

	function rename(
		obj: string | rename.Options | ((path: rename.ParsedPath, file: File) => rename.ParsedPath | string | void),
		options?: rename.PluginOptions,
	): NodeJS.ReadWriteStream;
}
