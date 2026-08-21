/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as http from 'http';
import { pathToFileURL } from 'url';
import { timeout } from '../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { CancellationError } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { delimiter, join, normalize } from '../../../base/common/path.js';
import { isWindows } from '../../../base/common/platform.js';
import { Promises } from '../../../base/node/pfs.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { DeepSeekHarnessColorScheme, DEEPSEEK_HARNESS_SUBMODULE_PATH, IDeepSeekHarnessService, IDeepSeekHarnessStartOptions, IDeepSeekHarnessStatus } from '../common/deepseekHarness.js';

interface IHarnessWorkspaceView {
	readonly workspaceId: string;
	readonly path: string;
}

export class DeepSeekHarnessMainService extends Disposable implements IDeepSeekHarnessService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeStatus = this._register(new Emitter<IDeepSeekHarnessStatus>());
	readonly onDidChangeStatus: Event<IDeepSeekHarnessStatus> = this._onDidChangeStatus.event;

	private status: IDeepSeekHarnessStatus = { state: 'stopped' };
	private child: ChildProcess | undefined;
	private startPromise: Promise<IDeepSeekHarnessStatus> | undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
	) {
		super();

		this._register(lifecycleMainService.onWillShutdown(e => {
			e.join('deepseekHarness', this.stop());
		}));
	}

	async getStatus(): Promise<IDeepSeekHarnessStatus> {
		return this.status;
	}

	async start(options: IDeepSeekHarnessStartOptions): Promise<IDeepSeekHarnessStatus> {
		if (this.status.state === 'running' && this.status.url) {
			await this.adoptEditor(options);
			return this.status;
		}

		if (this.startPromise) {
			const status = await this.startPromise;
			if (status.state === 'running') {
				await this.adoptEditor(options);
			}
			return status;
		}

		this.startPromise = this.doStart(options);
		try {
			const status = await this.startPromise;
			if (status.state === 'running') {
				await this.adoptEditor(options);
			}
			return status;
		} finally {
			this.startPromise = undefined;
		}
	}

	async syncTheme(colorScheme: DeepSeekHarnessColorScheme): Promise<void> {
		const url = this.status.url;
		if (this.status.state !== 'running' || !url) {
			return;
		}
		await this.applyTheme(url, colorScheme);
	}

	private async adoptEditor(options: IDeepSeekHarnessStartOptions): Promise<void> {
		if (options.colorScheme) {
			await this.syncTheme(options.colorScheme);
		}
		await this.syncWorkspaces(options.workspaceFolders ?? []);
	}

	async syncWorkspaces(folders: readonly string[]): Promise<void> {
		const url = this.status.url;
		if (this.status.state !== 'running' || !url) {
			return;
		}

		const ownedPaths = new Set<string>();
		for (const folder of folders) {
			try {
				const created = await this.rpc<{ workspace: IHarnessWorkspaceView }>(url, 'workspace.create', { path: folder });
				ownedPaths.add(this.canonicalPath(created.workspace.path));
			} catch (error) {
				this.logService.warn('[DeepSeek Harness] Failed to adopt editor workspace', folder, error);
			}
		}

		if (ownedPaths.size === 0) {
			return;
		}

		try {
			const listed = await this.rpc<{ items: IHarnessWorkspaceView[] }>(url, 'workspace.list', {});
			for (const item of listed.items) {
				if (ownedPaths.has(this.canonicalPath(item.path))) {
					continue;
				}
				try {
					await this.rpc(url, 'workspace.delete', { workspaceId: item.workspaceId });
				} catch (error) {
					this.logService.warn('[DeepSeek Harness] Failed to drop unrelated workspace', item.path, error);
				}
			}
		} catch (error) {
			this.logService.warn('[DeepSeek Harness] Failed to list workspaces for editor sync', error);
		}
	}

	async stop(): Promise<void> {
		const child = this.child;
		this.child = undefined;

		if (child && child.pid) {
			try {
				child.kill();
			} catch (error) {
				this.logService.warn('[DeepSeek Harness] Failed to stop process', error);
			}
		}

		this.setStatus({ state: 'stopped' });
	}

	private async doStart(options: IDeepSeekHarnessStartOptions): Promise<IDeepSeekHarnessStatus> {
		const url = `http://127.0.0.1:${options.port}`;

		if (await this.probe(url)) {
			this.logService.info(`[DeepSeek Harness] Reusing existing server at ${url}`);
			await this.applyTheme(url, options.colorScheme);
			this.setStatus({ state: 'running', url });
			return this.status;
		}

		this.setStatus({ state: 'starting', message: 'Starting DeepSeek Harness…' });

		let launch: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };
		try {
			launch = await this.resolveLaunch(options);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus({ state: 'error', message });
			return this.status;
		}

		this.logService.info(`[DeepSeek Harness] Spawning ${launch.command} ${launch.args.join(' ')} (cwd: ${launch.cwd})`);

		const child = spawn(launch.command, launch.args, {
			cwd: launch.cwd,
			env: launch.env,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		this.child = child;

		const stderrChunks: string[] = [];
		child.stdout?.on('data', (data: Buffer | string) => {
			this.logService.info(`[DeepSeek Harness] ${data.toString().trimEnd()}`);
		});
		child.stderr?.on('data', (data: Buffer | string) => {
			const text = data.toString();
			stderrChunks.push(text);
			if (stderrChunks.length > 40) {
				stderrChunks.shift();
			}
			this.logService.error(`[DeepSeek Harness] ${text.trimEnd()}`);
		});

		const exitPromise = new Promise<IDeepSeekHarnessStatus>(resolve => {
			child.once('error', error => {
				if (this.child === child) {
					this.child = undefined;
				}
				resolve({ state: 'error', message: error.message });
			});
			child.once('exit', (code, signal) => {
				if (this.child === child) {
					this.child = undefined;
				}
				const details = stderrChunks.join('').trim();
				const suffix = details ? `\n${details.slice(-2000)}` : '';
				resolve({
					state: 'error',
					message: `DeepSeek Harness exited${code !== null ? ` with code ${code}` : signal ? ` from signal ${signal}` : ''} before the Web UI was ready.${suffix}`
				});
			});
		});

		const cts = new CancellationTokenSource();
		const readyPromise = this.waitForReady(url, 30_000, cts.token).then((): IDeepSeekHarnessStatus => ({ state: 'running', url }));
		try {
			const result = await Promise.race([readyPromise, exitPromise]);
			if (result.state === 'running' && result.url) {
				await this.applyTheme(result.url, options.colorScheme);
			}
			this.setStatus(result);
			if (result.state !== 'running') {
				await this.stop();
				this.setStatus(result);
			}
			return this.status;
		} catch (error) {
			await this.stop();
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus({ state: 'error', message });
			return this.status;
		} finally {
			cts.cancel();
			cts.dispose();
			void readyPromise.then(undefined, () => { });
		}
	}

	private async resolveLaunch(options: IDeepSeekHarnessStartOptions): Promise<{ command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }> {
		const checkoutPath = options.checkoutPath?.trim() || join(this.environmentMainService.appRoot, DEEPSEEK_HARNESS_SUBMODULE_PATH);
		const extraArgs = [...(options.extraArgs ?? [])];
		const webArgs = ['web', '--no-open', '--host', '127.0.0.1', '--port', String(options.port), ...extraArgs];
		const workspaceCwd = options.workspaceFolders?.find(folder => folder.length > 0);
		const cwd = workspaceCwd || this.harnessHome();
		const env: NodeJS.ProcessEnv = {
			...process.env,
			DSH_HOME: this.harnessHome(),
		};

		const builtBin = join(checkoutPath, 'apps', 'cli', 'lib', 'bin.js');
		if (await Promises.exists(builtBin)) {
			const nodePath = await this.findNodeExecutable();
			return { command: nodePath.command, args: [...nodePath.prefixArgs, builtBin, ...webArgs], cwd, env: { ...env, ...nodePath.env } };
		}

		const tsxBin = join(checkoutPath, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs');
		const srcBin = join(checkoutPath, 'apps', 'cli', 'src', 'bin.ts');
		if (await Promises.exists(srcBin) && await Promises.exists(tsxBin)) {
			const nodePath = await this.findNodeExecutable();
			return {
				command: nodePath.command,
				args: [...nodePath.prefixArgs, '--import', pathToFileURL(tsxBin).href, srcBin, ...webArgs],
				cwd,
				env: { ...env, ...nodePath.env }
			};
		}

		const dshOnPath = await this.findOnPath('dsh');
		if (dshOnPath) {
			return { command: dshOnPath, args: webArgs, cwd, env };
		}

		throw new Error(`DeepSeek Harness is not built at ${checkoutPath}. Production builds must include the bundled runtime; for a source checkout run \`pnpm install && pnpm run build\` in that directory, or install \`dsh\` on PATH.`);
	}

	private harnessHome(): string {
		return join(this.environmentMainService.userDataPath, 'deepseek-harness-home');
	}

	private canonicalPath(path: string): string {
		const normalized = normalize(path).replace(/[\\/]+$/, '');
		return isWindows ? normalized.toLowerCase() : normalized;
	}

	private async applyTheme(url: string, colorScheme: DeepSeekHarnessColorScheme | undefined): Promise<void> {
		if (!colorScheme) {
			return;
		}
		try {
			await this.rpc(url, 'settings.update', {
				ns: 'ui-theme',
				patch: { preference: colorScheme },
			});
		} catch (error) {
			this.logService.warn('[DeepSeek Harness] Failed to sync editor color theme', error);
		}
	}

	private async rpc<T>(baseUrl: string, method: string, payload: unknown): Promise<T> {
		const response = await fetch(`${baseUrl}/api/${method}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				type: 'client-request',
				rpcId: randomUUID(),
				method,
				payload,
			}),
		});
		if (!response.ok) {
			throw new Error(`${method} HTTP ${response.status}`);
		}
		const body = await response.json() as { result?: { ok?: boolean; value?: T; error?: { message?: string } } };
		if (!body.result?.ok) {
			throw new Error(body.result?.error?.message || `${method} failed`);
		}
		return body.result.value as T;
	}

	private async findNodeExecutable(): Promise<{ command: string; prefixArgs: string[]; env: NodeJS.ProcessEnv }> {
		const nodeOnPath = await this.findOnPath('node');
		if (nodeOnPath) {
			return { command: nodeOnPath, prefixArgs: [], env: {} };
		}

		return {
			command: process.execPath,
			prefixArgs: [],
			env: { ELECTRON_RUN_AS_NODE: '1' }
		};
	}

	private async findOnPath(command: string): Promise<string | undefined> {
		const names = isWindows ? [`${command}.cmd`, `${command}.exe`, command] : [command];
		for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
			if (!dir) {
				continue;
			}
			for (const name of names) {
				const candidate = join(dir, name);
				if (await Promises.exists(candidate)) {
					return candidate;
				}
			}
		}
		return undefined;
	}

	private async waitForReady(url: string, timeoutMs: number, token: CancellationToken): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			if (await this.probe(url)) {
				return;
			}
			await timeout(250, token);
		}
		throw new Error(`Timed out waiting for DeepSeek Harness at ${url}`);
	}

	private probe(url: string): Promise<boolean> {
		return new Promise(resolve => {
			const req = http.get(url, res => {
				res.resume();
				resolve(true);
			});
			req.setTimeout(1000, () => {
				req.destroy();
				resolve(false);
			});
			req.on('error', () => resolve(false));
		});
	}

	private setStatus(status: IDeepSeekHarnessStatus): void {
		this.status = status;
		this._onDidChangeStatus.fire(status);
	}
}
