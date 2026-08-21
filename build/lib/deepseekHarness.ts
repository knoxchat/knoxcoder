/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const root = path.dirname(path.dirname(import.meta.dirname));
const checkoutRelativePath = 'third_party/deepseek-harness';
const checkoutPath = path.join(root, checkoutRelativePath);
const builtBinRelativePath = path.join('apps', 'cli', 'lib', 'bin.js');
const ensureScript = path.join(root, 'scripts', 'ensure-deepseek-harness.sh');
const gitHttpsArgs = ['-c', 'url.https://github.com/.insteadOf=git@github.com:'];

const skippedDirectoryNames = new Set([
	'.git',
	'.github',
	'.agents',
	'.turbo',
	'.cache',
	'.claude',
	'.DS_Store',
	'.dsh-build',
	'.ignored',
	'.pnpm-store',
	'website',
	'docs',
	'coverage',
	'test',
	'tests',
	'e2e',
	'__tests__',
]);

function log(message: string): void {
	console.log(`[deepseek-harness] ${message}`);
}

function run(command: string, cwd: string): void {
	cp.execSync(command, {
		cwd,
		stdio: 'inherit',
		env: process.env,
		shell: true,
	});
}

function git(args: string[], cwd = root): string {
	return cp.execFileSync('git', [...gitHttpsArgs, ...args], {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
	}).trim();
}

function harnessUrl(): string {
	try {
		return git(['config', '-f', '.gitmodules', '--get', 'submodule.third_party/deepseek-harness.url']);
	} catch {
		return 'https://github.com/deepseek-ai/deepseek-harness.git';
	}
}

function recordedSha(): string | undefined {
	try {
		const line = git(['ls-tree', 'HEAD', checkoutRelativePath]);
		const sha = line.split(/\s+/)[2];
		return sha && /^[0-9a-f]{40}$/i.test(sha) ? sha : undefined;
	} catch {
		return undefined;
	}
}

function checkoutWithGit(): void {
	log(`Cloning DeepSeek Harness submodule at ${checkoutRelativePath}...`);
	try {
		git(['submodule', 'sync', '--recursive', '--', checkoutRelativePath]);
		git(['submodule', 'update', '--init', '--recursive', '--', checkoutRelativePath]);
	} catch {
		log('Submodule update failed; cloning from .gitmodules URL...');
		fs.rmSync(checkoutPath, { recursive: true, force: true });
		fs.mkdirSync(path.dirname(checkoutPath), { recursive: true });
		git(['clone', '--recurse-submodules', harnessUrl(), checkoutPath]);
		const sha = recordedSha();
		if (sha) {
			try {
				git(['fetch', '--depth', '1', 'origin', sha], checkoutPath);
			} catch {
				git(['fetch', 'origin', sha], checkoutPath);
			}
			git(['checkout', '--detach', sha], checkoutPath);
		}
	}
}

export function ensureCheckout(): void {
	if (fs.existsSync(path.join(checkoutPath, 'package.json'))) {
		log('DeepSeek Harness checkout is present.');
		return;
	}

	try {
		run(`bash "${ensureScript}" checkout-only`, root);
	} catch {
		checkoutWithGit();
	}

	if (!fs.existsSync(path.join(checkoutPath, 'package.json'))) {
		throw new Error(`DeepSeek Harness submodule is missing at ${checkoutPath}.`);
	}
}

function ensurePnpm(): void {
	try {
		cp.execSync('pnpm --version', { stdio: 'pipe', shell: true });
		return;
	} catch {
		// Install via corepack, which ships with Node 24.
	}

	try {
		run('corepack enable', root);
	} catch {
		// corepack may already be enabled or unavailable; prepare still often works.
	}
	run('corepack prepare pnpm@11.7.0 --activate', root);
}

function shouldCopy(sourcePath: string): boolean {
	const name = path.basename(sourcePath);
	if (skippedDirectoryNames.has(name)) {
		return false;
	}
	if (name.endsWith('.map')) {
		return false;
	}
	return true;
}

export async function buildDeepSeekHarness(): Promise<void> {
	ensureCheckout();
	ensurePnpm();

	log(`Installing dependencies in ${checkoutPath}...`);
	run(process.env['CI'] ? 'pnpm install --frozen-lockfile' : 'pnpm install', checkoutPath);

	const builtBin = path.join(checkoutPath, builtBinRelativePath);
	if (fs.existsSync(builtBin) && process.env['DEEPSEEK_HARNESS_FORCE_BUILD'] !== '1') {
		log(`Using existing CLI at ${builtBin}`);
		return;
	}

	log('Building DeepSeek Harness...');
	run('pnpm run build', checkoutPath);

	if (!fs.existsSync(builtBin)) {
		throw new Error(`DeepSeek Harness build did not produce ${builtBin}.`);
	}
	log(`Built CLI at ${builtBin}`);
}

export async function copyDeepSeekHarnessToAppRoot(appRoot: string): Promise<void> {
	ensureCheckout();

	const builtBin = path.join(checkoutPath, builtBinRelativePath);
	if (!fs.existsSync(builtBin)) {
		await buildDeepSeekHarness();
	}

	const destination = path.join(appRoot, checkoutRelativePath);
	log(`Copying runtime into ${destination}...`);
	fs.rmSync(destination, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	fs.cpSync(checkoutPath, destination, {
		recursive: true,
		// Windows pnpm uses absolute junctions; copy real files so the
		// packaged tree does not point back at the build machine.
		dereference: process.platform === 'win32',
		// Node's default cp rewrites relative symlinks to absolute source
		// paths. Apple codesign --strict then fails with "invalid destination
		// for symbolic link in bundle".
		verbatimSymlinks: process.platform !== 'win32',
		filter: shouldCopy,
	});

	if (process.platform !== 'win32') {
		rewriteBundledSymlinks(destination);
	}

	const packagedBin = path.join(destination, builtBinRelativePath);
	if (!fs.existsSync(packagedBin)) {
		throw new Error(`Packaged DeepSeek Harness is missing ${packagedBin}.`);
	}
	log('Packaged DeepSeek Harness runtime is ready.');
}

function isInside(child: string, parent: string): boolean {
	const relative = path.relative(parent, child);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathExists(filePath: string): boolean {
	try {
		fs.lstatSync(filePath);
		return true;
	} catch {
		return false;
	}
}

function rewriteBundledSymlinks(destination: string): void {
	const destRoot = fs.realpathSync(destination);
	let rewritten = 0;
	let removed = 0;

	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isSymbolicLink()) {
				const outcome = rewriteOneLink(fullPath, destRoot);
				if (outcome === 'rewritten') {
					rewritten++;
				} else if (outcome === 'removed') {
					removed++;
				}
				continue;
			}
			if (entry.isDirectory()) {
				walk(fullPath);
			}
		}
	};

	walk(destination);
	log(`Bundled symlinks rewritten=${rewritten} removed=${removed}.`);
}

function rewriteOneLink(linkPath: string, destRoot: string): 'kept' | 'rewritten' | 'removed' {
	const target = fs.readlinkSync(linkPath);
	const resolved = path.resolve(path.dirname(linkPath), target);
	if (!isInside(resolved, destRoot) || !pathExists(resolved)) {
		fs.unlinkSync(linkPath);
		return 'removed';
	}
	if (path.isAbsolute(target)) {
		fs.unlinkSync(linkPath);
		fs.symlinkSync(path.relative(path.dirname(linkPath), resolved), linkPath);
		return 'rewritten';
	}
	return 'kept';
}

if (import.meta.main) {
	const mode = process.argv[2] ?? 'all';
	let running: Promise<void>;
	if (mode === 'checkout-only') {
		running = Promise.resolve(ensureCheckout());
	} else if (mode === 'copy') {
		const appRoot = process.argv[3];
		if (!appRoot) {
			console.error('Usage: node build/lib/deepseekHarness.ts copy <appRoot>');
			process.exit(1);
		}
		running = copyDeepSeekHarnessToAppRoot(appRoot);
	} else {
		running = buildDeepSeekHarness();
	}
	running.catch(error => {
		console.error(error);
		process.exitCode = 1;
	});
}
