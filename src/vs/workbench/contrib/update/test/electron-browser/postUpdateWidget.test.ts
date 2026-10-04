/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CommandsRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { IMeteredConnectionService } from '../../../../../platform/meteredConnection/common/meteredConnection.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { PostUpdateWidgetContribution } from '../../browser/postUpdateWidget.js';

suite('PostUpdateWidgetContribution (Electron)', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createContribution(isConnectionMetered: boolean): void {
		const configurationService = new TestConfigurationService();
		store.add(configurationService.onDidChangeConfigurationEmitter);
		store.add(new PostUpdateWidgetContribution(
			new class extends mock<ICommandService>() { },
			configurationService,
			new class extends mock<IHostService>() {
				override hadLastFocus(): Promise<boolean> {
					return Promise.resolve(true);
				}
			},
			new class extends mock<IHoverService>() { },
			new class extends mock<ILayoutService>() { },
			new class extends mock<IMarkdownRendererService>() { },
			new class extends mock<IMeteredConnectionService>() {
				override readonly isConnectionMetered = isConnectionMetered;
			},
			new class extends mock<IOpenerService>() { },
			new class extends mock<IProductService>() {
				override readonly version = '1.135.0';
				override readonly commit = 'current';
			},
			new class extends mock<IStorageService>() {
				override getObject<T>(): T | undefined {
					return { version: '1.134.0', commit: 'previous', timestamp: 0 } as T;
				}
				override store(): void { }
			},
			new class extends mock<ITelemetryService>() { },
		));
	}

	test('does not make any network request after a version change (release notes come from GitHub on demand)', async () => {
		// The contribution no longer receives a request service; construction must not throw.
		createContribution(false);
		await timeout(0);
	});

	test('registers the explicit update info command while metered', async () => {
		createContribution(true);
		await timeout(0);

		assert.ok(CommandsRegistry.getCommand('_update.showUpdateInfo'));
	});
});
