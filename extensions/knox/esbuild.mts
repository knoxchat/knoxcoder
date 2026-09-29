/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Packaging + gulp bundle for the in-tree Knox extension.
 *
 * KN-200–202: host / core / knoxdev-package live under extensions/knox/src.
 * Dev compile (`gulp compile-extension:knox --copy-to-out`) also writes
 * `out/extension.js`, which `scripts/code.sh` loads through package.json `main`.
 *
 * KN-384: `fromLocal()` rewrites `main` `/out/` → `/dist/` when this file exists,
 * so the packaged outfile must be `dist/extension.js`. Product packaging is
 * gulp `compile-extension:knox` + `compile-extension-knox-native` only (this
 * script also copies natives). Knox is a `nativeExtensions` member, not a
 * `builtInExtensions` marketplace entry.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Plugin } from 'esbuild';
import { run } from '../esbuild-extension-common.mts';
import { copyKnoxNativeAssets } from './scripts/copy-native.mts';
import { assertKnoxNativeInventory } from './scripts/inventory-gate.mts';

const extensionDir = import.meta.dirname;
const knoxCoreDir = path.join(extensionDir, 'src', 'core');
const knoxPkgDir = path.join(extensionDir, 'src', 'pkg');
const hostEntry = path.join(extensionDir, 'src', 'extension.ts');
const importMetaUrlShim = path.join(extensionDir, 'scripts', 'importMetaUrl.js');
const coreShim = path.join(extensionDir, 'scripts', 'core-package-shim.js');
const srcDir = path.join(extensionDir, 'src');
const outDir = path.join(extensionDir, 'dist');

const copyToOut = process.argv.includes('--copy-to-out');
const isDev = process.argv.includes('--dev');

function nodeModuleDirs(): string[] {
	return [
		path.join(extensionDir, 'node_modules'),
	].filter((dir) => fs.existsSync(dir));
}

function findNodeFile(relPath: string): string | undefined {
	for (const dir of nodeModuleDirs()) {
		const candidate = path.join(dir, relPath);
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

const knoxResolvePlugin: Plugin = {
	name: 'knox-core-knoxdev-alias',
	setup(build) {
		build.onResolve({ filter: /^core$/ }, () => ({ path: coreShim }));
		build.onResolve({ filter: /^core\// }, async (args) => {
			const subpath = args.path.slice('core/'.length);
			return build.resolve('./' + subpath, {
				kind: args.kind,
				resolveDir: knoxCoreDir,
			});
		});
		build.onResolve({ filter: /^knoxdev-package(\/|$)/ }, (args) => {
			const exportMap: Record<string, string> = {
				'knoxdev-package/config-yaml': path.join(knoxPkgDir, 'config-yaml', 'index.ts'),
				'knoxdev-package/fetch': path.join(knoxPkgDir, 'fetch', 'index.ts'),
				'knoxdev-package/openai-adapters': path.join(knoxPkgDir, 'openai-adapters', 'index.ts'),
				'knoxdev-package/openai-adapters/apis/base': path.join(knoxPkgDir, 'openai-adapters', 'apis', 'base.ts'),
			};
			const mapped = exportMap[args.path];
			if (mapped && fs.existsSync(mapped)) {
				return { path: mapped };
			}
			const subpath = args.path.replace(/^knoxdev-package\/?/, '');
			const tsFallback = path.join(knoxPkgDir, subpath.endsWith('.ts') ? subpath : `${subpath}.ts`);
			if (fs.existsSync(tsFallback)) {
				return { path: tsFallback };
			}
			return { path: path.join(knoxPkgDir, subpath) };
		});
	},
};

const jsdomInlineDefaultStylesheet: Plugin = {
	name: 'jsdom-inline-default-stylesheet',
	setup(build) {
		build.onLoad({ filter: /jsdom[/\\]lib[/\\]jsdom[/\\]living[/\\]css[/\\]helpers[/\\]computed-style\.js$/ }, async (args) => {
			let contents = await fs.promises.readFile(args.path, 'utf8');
			const cssPath = path.resolve(path.dirname(args.path), '../../../browser/default-stylesheet.css');
			if (fs.existsSync(cssPath)) {
				const cssContent = await fs.promises.readFile(cssPath, 'utf8');
				contents = contents.replace(
					/const defaultStyleSheet = fs\.readFileSync\(\s*path\.resolve\(__dirname,\s*"\.\.\/\.\.\/\.\.\/browser\/default-stylesheet\.css"\)\s*,\s*\{\s*encoding:\s*"utf-8"\s*\}\s*\);/,
					`const defaultStyleSheet = ${JSON.stringify(cssContent)};`,
				);
			}
			return { contents, loader: 'js' };
		});
	},
};

const cssTreeInlineJson: Plugin = {
	name: 'css-tree-inline-json',
	setup(build) {
		build.onLoad({ filter: /css-tree[/\\]lib[/\\]data-patch\.js$/ }, async (args) => {
			const contents = `import patch from '../data/patch.json';\nexport default patch;`;
			return { contents, loader: 'js', resolveDir: path.dirname(args.path) };
		});
		build.onLoad({ filter: /css-tree[/\\]lib[/\\]data\.js$/ }, async (args) => {
			let contents = await fs.promises.readFile(args.path, 'utf8');
			const imports = [
				`import mdnAtrules from 'mdn-data/css/at-rules.json';`,
				`import mdnProperties from 'mdn-data/css/properties.json';`,
				`import mdnSyntaxes from 'mdn-data/css/syntaxes.json';`,
			].join('\n');
			contents = contents.replace(/import\s*\{\s*createRequire\s*\}\s*from\s*['"]module['"];/, '');
			contents = contents.replace(/const\s+require\s*=\s*createRequire\(import\.meta\.url\);/, '');
			contents = contents.replace(/const\s+mdnAtrules\s*=\s*require\(['"]mdn-data\/css\/at-rules\.json['"]\);/, '');
			contents = contents.replace(/const\s+mdnProperties\s*=\s*require\(['"]mdn-data\/css\/properties\.json['"]\);/, '');
			contents = contents.replace(/const\s+mdnSyntaxes\s*=\s*require\(['"]mdn-data\/css\/syntaxes\.json['"]\);/, '');
			return { contents: imports + '\n' + contents, loader: 'js', resolveDir: path.dirname(args.path) };
		});
	},
};

function copyXhrSyncWorker(destDir: string): void {
	const sourcePath = findNodeFile(path.join('jsdom', 'lib', 'jsdom', 'living', 'xhr', 'xhr-sync-worker.js'));
	if (!sourcePath) {
		return;
	}
	fs.mkdirSync(destDir, { recursive: true });
	fs.copyFileSync(sourcePath, path.join(destDir, 'xhr-sync-worker.js'));
}

async function copyDistToOut(distDir: string): Promise<void> {
	const dest = path.join(extensionDir, 'out');
	await fs.promises.mkdir(dest, { recursive: true });
	await fs.promises.cp(distDir, dest, { recursive: true });
}

await run({
	platform: 'node',
	entryPoints: {
		extension: hostEntry,
	},
	srcDir,
	outdir: outDir,
	additionalWatchPaths: [
		path.join(extensionDir, 'src'),
	],
	additionalOptions: {
		absWorkingDir: extensionDir,
		nodePaths: nodeModuleDirs(),
		external: ['vscode', 'sqlite3', 'node-pty', 'esbuild', './xhr-sync-worker.js'],
		loader: { '.node': 'file', '.json': 'json' },
		inject: fs.existsSync(importMetaUrlShim) ? [importMetaUrlShim] : undefined,
		define: { 'import.meta.url': 'importMetaUrl' },
		supported: { 'dynamic-import': false },
		minify: !isDev,
		sourcemap: true,
		plugins: [knoxResolvePlugin, jsdomInlineDefaultStylesheet, cssTreeInlineJson],
	},
	beforeBuild: () => {
		assertKnoxNativeInventory();
		copyXhrSyncWorker(outDir);
		const configYaml = path.join(knoxPkgDir, 'config-yaml', 'index.ts');
		if (!fs.existsSync(configYaml)) {
			throw new Error(`Knox pkg is missing (${configYaml}). Expected KN-200 sources under extensions/knox/src/pkg.`);
		}
		const coreEntry = path.join(knoxCoreDir, 'core.ts');
		if (!fs.existsSync(coreEntry)) {
			throw new Error(`Knox core is missing (${coreEntry}). Expected KN-201 sources under extensions/knox/src/core.`);
		}
		if (!fs.existsSync(hostEntry)) {
			throw new Error(`Knox host entry not found: ${hostEntry}`);
		}
	},
}, process.argv, async (builtDir) => {
	copyXhrSyncWorker(builtDir);
	await copyKnoxNativeAssets(builtDir);
	if (copyToOut && !process.argv.includes('--outputRoot')) {
		await copyDistToOut(builtDir);
	}
	const bundle = path.join(builtDir, 'extension.js');
	if (!fs.existsSync(bundle)) {
		throw new Error(`Knox esbuild did not produce ${bundle}`);
	}
	console.log(`Knox host bundle: ${bundle}`);
});
