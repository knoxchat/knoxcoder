/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { isWindows } from '../../../../base/common/platform.js';
import { hasKey } from '../../../../base/common/types.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { IProductService } from '../../../product/common/productService.js';
import { IShellLaunchConfig, ITerminalProcessOptions } from '../../common/terminal.js';
import { ChildProcessMonitor } from '../../node/childProcessMonitor.js';
import { TerminalProcess } from '../../node/terminalProcess.js';

suite('TerminalProcess startup disposal', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const options: ITerminalProcessOptions = {
		shellIntegration: { enabled: false, suggestEnabled: false, nonce: '' },
		windowsUseConptyDll: false,
		environmentVariableCollections: undefined,
		workspaceFolder: undefined,
		isScreenReaderOptimized: false
	};

	function createTerminal(shellLaunchConfig?: IShellLaunchConfig, cwd = process.cwd(), throttle?: () => Promise<void>, spawnPty?: () => IPty) {
		let spawnAttempts = 0;
		class TestTerminalProcess extends TerminalProcess {
			protected override _throttleKillSpawn(): Promise<void> {
				return throttle ? throttle() : super._throttleKillSpawn();
			}
			protected override _spawnPty(file: string, args: string | string[], options: IPtyForkOptions | IWindowsPtyForkOptions): IPty {
				return spawnPty ? spawnPty() : super._spawnPty(file, args, options);
			}
		}
		class Log extends NullLogService {
			override trace(message: string): void {
				if (message === 'node-pty.IPty#spawn') {
					spawnAttempts++;
				}
			}
		}
		const log = store.add(new Log());
		const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
		const terminal = store.add(new TestTerminalProcess(
			shellLaunchConfig ?? { executable: process.execPath, args: ['-e', 'setTimeout(() => process.exit(0), 250)'] },
			cwd, 80, 24, env, env, options, log, { applicationName: 'vscode' } as IProductService
		));
		return {
			terminal,
			observe: () => ({
				spawnAttempts,
				nativePtyPresent: Reflect.get(terminal, '_ptyProcess') !== undefined,
				titlePolling: Reflect.get(terminal, '_titleInterval') !== undefined
			}),
			cleanup: () => {
				// Clean this test's handles if a regression recreates resources after disposal.
				const interval: ReturnType<typeof setInterval> | undefined = Reflect.get(terminal, '_titleInterval');
				if (interval) {
					clearInterval(interval);
				}
				const pty: IPty | undefined = Reflect.get(terminal, '_ptyProcess');
				try {
					pty?.kill();
				} catch {
					// The short-lived child may already have exited.
				}
				const monitor: ChildProcessMonitor | undefined = Reflect.get(terminal, '_childProcessMonitor');
				monitor?.dispose();
				terminal.dispose();
			}
		};
	}

	async function shutdown(terminal: TerminalProcess, immediate = true): Promise<void> {
		const exited = new Promise<void>(resolve => store.add(Event.once(terminal.onProcessExit)(() => resolve())));
		terminal.shutdown(immediate);
		await exited;
	}

	for (const immediate of [true, false]) {
		test(`does not spawn after shutdown during asynchronous validation (immediate: ${immediate})`, async () => {
			const throttle = new DeferredPromise<void>();
			const fixture = createTerminal(undefined, process.cwd(), () => throttle.p);
			try {
				const startup = fixture.terminal.start();
				await shutdown(fixture.terminal, immediate);
				await throttle.complete();
				await startup;
				assert.deepStrictEqual(fixture.observe(), { spawnAttempts: 0, nativePtyPresent: false, titlePolling: false });
			} finally {
				await throttle.complete();
				fixture.cleanup();
			}
		});
	}

	test('does not spawn when started after shutdown', async () => {
		const fixture = createTerminal();
		try {
			await shutdown(fixture.terminal);
			await fixture.terminal.start();
			assert.deepStrictEqual(fixture.observe(), { spawnAttempts: 0, nativePtyPresent: false, titlePolling: false });
		} finally {
			fixture.cleanup();
		}
	});

	test('does not spawn after disposal during asynchronous validation', async () => {
		const fixture = createTerminal();
		try {
			const startup = fixture.terminal.start();
			fixture.terminal.dispose();
			await startup;
			assert.deepStrictEqual(fixture.observe(), { spawnAttempts: 0, nativePtyPresent: false, titlePolling: false });
		} finally {
			fixture.cleanup();
		}
	});

	test('does not spawn after disposal while spawn throttling is pending', async () => {
		const started = new DeferredPromise<void>();
		const throttle = new DeferredPromise<void>();
		const fixture = createTerminal(undefined, process.cwd(), () => {
			started.complete();
			return throttle.p;
		});
		try {
			const startup = fixture.terminal.start();
			await started.p;
			fixture.terminal.dispose();
			await throttle.complete();
			await startup;
			assert.deepStrictEqual(fixture.observe(), { spawnAttempts: 0, nativePtyPresent: false, titlePolling: false });
		} finally {
			await throttle.complete();
			fixture.cleanup();
		}
	});

	function createDeferredPty(readyPid: number, readyDelayMs = 20, exitBeforeReady?: number): IPty {
		const dataListeners = new Set<(data: string) => void>();
		const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();
		let pid = 0;
		let killed = false;
		let readyTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
			readyTimer = undefined;
			if (exitBeforeReady !== undefined) {
				fireExit(exitBeforeReady);
				return;
			}
			pid = readyPid;
			for (const listener of [...dataListeners]) {
				listener('knox-terminal-ok');
			}
		}, readyDelayMs);

		function fireExit(exitCode: number): void {
			if (killed) {
				return;
			}
			killed = true;
			if (readyTimer) {
				clearTimeout(readyTimer);
				readyTimer = undefined;
			}
			for (const listener of [...exitListeners]) {
				listener({ exitCode });
			}
		}

		return {
			get pid() { return pid; },
			cols: 80,
			rows: 24,
			process: 'fakeshell',
			handleFlowControl: false,
			onData: (listener: (data: string) => void) => {
				dataListeners.add(listener);
				return { dispose: () => dataListeners.delete(listener) };
			},
			onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
				exitListeners.add(listener);
				return { dispose: () => exitListeners.delete(listener) };
			},
			write() { },
			resize() { },
			clear() { },
			pause() { },
			resume() { },
			kill() { fireExit(0); }
		} as IPty;
	}

	// Electron mocha runs in the renderer. node-pty's ConPTY worker_threads cannot
	// assign a live pid there, so this suite uses a deferred fake IPty. The real
	// cmd.exe spawn (error 193) is gated by windows-terminal-spawn.mjs --spawn
	// under ELECTRON_RUN_AS_NODE=1.
	test('starts a deferred pty process and cleans up on normal shutdown', async function () {
		this.timeout(15000);
		const fixture = createTerminal(undefined, process.cwd(), undefined, () => createDeferredPty(4242));
		const ready = new DeferredPromise<number>();
		store.add(fixture.terminal.onProcessReady(event => ready.complete(event.pid)));
		try {
			const result = await fixture.terminal.start();
			if (result && hasKey(result, { message: true })) {
				assert.fail(result.message);
			}
			assert.strictEqual(result, undefined, 'start() should succeed after the deferred pid is assigned');
			const pid = await ready.p;
			assert.strictEqual(pid, 4242, `expected the deferred fake pid after start(), got ${pid}`);
			await shutdown(fixture.terminal);
			assert.deepStrictEqual(fixture.observe(), { spawnAttempts: 1, nativePtyPresent: false, titlePolling: false });
		} finally {
			fixture.cleanup();
		}
	});

	(isWindows ? test : test.skip)('returns a launch error when ConPTY connect fails before pid', async function () {
		this.timeout(15000);
		const fixture = createTerminal(undefined, process.cwd(), undefined, () => createDeferredPty(4242, 20, 193));
		try {
			const result = await fixture.terminal.start();
			assert.ok(result && hasKey(result, { message: true }) && result.message);
			assert.match(result.message, /193/);
			await shutdown(fixture.terminal);
			assert.deepStrictEqual(fixture.observe(), { spawnAttempts: 1, nativePtyPresent: false, titlePolling: false });
		} finally {
			fixture.cleanup();
		}
	});

	test('preserves invalid executable launch errors without spawning', async () => {
		const fixture = createTerminal({ executable: '/nonexistent/terminal-startup-disposal-test' });
		try {
			const result = await fixture.terminal.start();
			assert.ok(result && hasKey(result, { message: true }) && result.message);
			assert.deepStrictEqual(fixture.observe(), { spawnAttempts: 0, nativePtyPresent: false, titlePolling: false });
		} finally {
			fixture.cleanup();
		}
	});

	test('preserves invalid cwd launch errors without spawning', async () => {
		const fixture = createTerminal(undefined, '/nonexistent/terminal-startup-disposal-test');
		try {
			const result = await fixture.terminal.start();
			assert.ok(result && hasKey(result, { message: true }) && result.message);
			assert.deepStrictEqual(fixture.observe(), { spawnAttempts: 0, nativePtyPresent: false, titlePolling: false });
		} finally {
			fixture.cleanup();
		}
	});
});
