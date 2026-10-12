/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { captureDomState, keyedScrolls, restoreDomState, scrollKey } from './preserve.js';

suite('Knox GUI DOM preserve', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function withScroll(el: HTMLElement, top: number, left = 0): HTMLElement {
		Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: top });
		Object.defineProperty(el, 'scrollLeft', { configurable: true, writable: true, value: left });
		return el;
	}

	function tree(): { root: HTMLElement; body: HTMLElement; overlay: HTMLElement } {
		const root = document.createElement('div');
		const body = withScroll(document.createElement('div'), 40);
		body.className = 'knox-gui-body';
		body.setAttribute('data-testid', 'knox-gui-body');
		const composer = document.createElement('div');
		const overlay = withScroll(document.createElement('div'), 180);
		overlay.className = 'knox-gui-overlay';
		overlay.setAttribute('data-testid', 'knox-gui-overlay-settings');
		composer.appendChild(overlay);
		root.append(body, composer);
		return { root, body, overlay };
	}

	test('captures overlay scroll outside the transcript scroller', () => {
		const { root, body } = tree();
		const snapshot = captureDomState(root, body);
		assert.strictEqual(snapshot.scrolls.length, 1);
		assert.strictEqual(snapshot.scrolls[0].top, 180);
		assert.strictEqual(snapshot.scrolls[0].key, 'knox-gui-overlay-settings');
	});

	test('does not capture the transcript scroller itself', () => {
		const { root, body } = tree();
		const snapshot = captureDomState(root, body);
		assert.ok(!snapshot.scrolls.some(entry => entry.key === 'knox-gui-body'));
	});

	test('captures the page body when it is not the transcript scroller', () => {
		const { root, body } = tree();
		body.classList.add('knox-gui-page');
		const snapshot = captureDomState(root);
		assert.ok(snapshot.scrolls.some(entry => entry.key === 'knox-gui-body' && entry.top === 40));
	});

	test('restores overlay scroll after a full rebuild', () => {
		const { root, body, overlay } = tree();
		const snapshot = captureDomState(root, body);
		overlay.scrollTop = 0;
		restoreDomState(root, snapshot);
		assert.strictEqual(overlay.scrollTop, 180);
	});

	test('restores overlay scroll by key when siblings shift', () => {
		const { root, body } = tree();
		const snapshot = captureDomState(root, body);
		root.replaceChildren();
		const tabs = document.createElement('div');
		const body2 = document.createElement('div');
		const composer = document.createElement('div');
		const overlay = withScroll(document.createElement('div'), 0);
		overlay.setAttribute('data-testid', 'knox-gui-overlay-settings');
		composer.appendChild(overlay);
		root.append(tabs, body2, composer);
		restoreDomState(root, snapshot);
		assert.strictEqual(overlay.scrollTop, 180);
	});

	test('restores nested panel scroll via ancestor testid', () => {
		const root = document.createElement('div');
		const panel = document.createElement('div');
		panel.setAttribute('data-testid', 'git-diff-status-panel');
		const inner = withScroll(document.createElement('div'), 90);
		inner.className = 'knox-gui-attached-body';
		panel.appendChild(inner);
		root.appendChild(panel);
		assert.strictEqual(scrollKey(inner), 'git-diff-status-panel::.knox-gui-attached-body');
		const snapshot = captureDomState(root);
		root.replaceChildren();
		const panel2 = document.createElement('div');
		panel2.setAttribute('data-testid', 'git-diff-status-panel');
		const inner2 = withScroll(document.createElement('div'), 0);
		inner2.className = 'knox-gui-attached-body';
		panel2.appendChild(inner2);
		root.appendChild(panel2);
		restoreDomState(root, snapshot);
		assert.strictEqual(inner2.scrollTop, 90);
	});

	test('keyedScrolls keeps only hosts that can be found after a rebuild', () => {
		const { root, body } = tree();
		const snapshot = captureDomState(root, body);
		assert.deepStrictEqual(keyedScrolls(snapshot).scrolls.map(entry => entry.key), ['knox-gui-overlay-settings']);
	});
});
