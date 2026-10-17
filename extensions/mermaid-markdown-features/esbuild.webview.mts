/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'node:fs';
import path from 'path';
import esbuild, { type Plugin } from 'esbuild';
import { run } from '../esbuild-webview-common.mts';

const rootDir = import.meta.dirname;
const previewSrcDir = path.join(rootDir, 'preview-src');
const webviewOutDir = path.join(rootDir, 'webview-out');

const STALE_WEBVIEW_OUT_DIRS = [
	'markdown-preview-out',
	'notebook-out',
	'diagram-webview-out',
];

const cssTextPlugin: Plugin = {
	name: 'css-text',
	setup(build) {
		build.onLoad({ filter: /diagramStyles\.css$/ }, async args => {
			const result = await esbuild.build({
				entryPoints: [args.path],
				bundle: true,
				minify: true,
				write: false,
				loader: {
					'.ttf': 'dataurl',
					'.woff': 'dataurl',
					'.woff2': 'dataurl',
				},
			});
			const css = result.outputFiles[0].text;
			return {
				contents: `export default ${JSON.stringify(css)};`,
				loader: 'js',
			};
		});
	},
};

const mermaidMarkdownBuildOptions: Partial<esbuild.BuildOptions> = {
	loader: {
		'.ttf': 'dataurl',
	},
	plugins: [cssTextPlugin],
	splitting: true,
};

function firstExisting(candidates: string[]): string | undefined {
	return candidates.find(candidate => fs.existsSync(candidate));
}

function copyCodicons(outDir: string): void {
	const dist = firstExisting([
		path.join(rootDir, 'node_modules', '@vscode', 'codicons', 'dist'),
		path.join(rootDir, '..', 'node_modules', '@vscode', 'codicons', 'dist'),
		path.join(rootDir, '..', '..', 'node_modules', '@vscode', 'codicons', 'dist'),
	]);
	if (!dist) {
		throw new Error('Mermaid webview: @vscode/codicons dist not found');
	}
	fs.mkdirSync(outDir, { recursive: true });
	for (const name of ['codicon.css', 'codicon.ttf']) {
		const source = path.join(dist, name);
		if (!fs.existsSync(source)) {
			throw new Error(`Mermaid webview: missing ${source}`);
		}
		fs.copyFileSync(source, path.join(outDir, name));
	}
}

function removeStaleWebviewOutDirs(outDir: string): void {
	for (const parent of new Set([rootDir, path.dirname(outDir)])) {
		for (const name of STALE_WEBVIEW_OUT_DIRS) {
			const stale = path.join(parent, name);
			if (path.resolve(stale) !== path.resolve(outDir)) {
				fs.rmSync(stale, { recursive: true, force: true });
			}
		}
	}
}

await run({
	entryPoints: {
		markdown: path.join(previewSrcDir, 'markdown', 'index.ts'),
		notebook: path.join(previewSrcDir, 'notebook', 'index.ts'),
		'index-editor': path.join(previewSrcDir, 'diagram', 'index-editor.ts'),
	},
	srcDir: previewSrcDir,
	outdir: webviewOutDir,
	additionalOptions: mermaidMarkdownBuildOptions,
}, process.argv, outDir => {
	copyCodicons(outDir);
	removeStaleWebviewOutDirs(outDir);
});
