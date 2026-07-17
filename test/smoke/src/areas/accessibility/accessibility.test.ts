/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Logger, Quality } from '../../../../automation';
import { installAllHandlers } from '../../utils';

export function setup(logger: Logger, opts: { web?: boolean }, quality: Quality) {
	describe('Accessibility', function () {

		// Increase timeout for accessibility scans
		this.timeout(2 * 60 * 1000);

		// Retry tests to minimize flakiness
		this.retries(2);

		// Shared before/after handling
		installAllHandlers(logger);

		let app: Application;

		before(async function () {
			app = this.app as Application;
		});

		describe('Workbench', function () {

			(opts.web ? it.skip : it)('workbench has no accessibility violations', async function () {
				// Wait for workbench to be fully loaded
				await app.code.waitForElement('.monaco-workbench');

				await app.code.driver.assertNoAccessibilityViolations({
					selector: '.monaco-workbench',
					excludeRules: {
						// Monaco lists use aria-multiselectable on role="list" and aria-setsize/aria-posinset/aria-selected on role="dialog" rows
						// These violations appear intermittently when notification lists or other dynamic lists are visible
						// Note: patterns match against HTML string, not CSS selectors, so no leading dots
						'aria-allowed-attr': ['monaco-list', 'monaco-list-row'],
						// Monaco lists may temporarily contain dialog children during extension activation errors
						'aria-required-children': ['monaco-list']
					}
				});
			});

			it('activity bar has no accessibility violations', async function () {
				await app.code.waitForElement('.activitybar');

				await app.code.driver.assertNoAccessibilityViolations({
					selector: '.activitybar'
				});
			});

			it('sidebar has no accessibility violations', async function () {
				await app.code.waitForElement('.sidebar');

				await app.code.driver.assertNoAccessibilityViolations({
					selector: '.sidebar'
				});
			});

			it('status bar has no accessibility violations', async function () {
				await app.code.waitForElement('.statusbar');

				await app.code.driver.assertNoAccessibilityViolations({
					selector: '.statusbar'
				});
			});
		});
	});
}
