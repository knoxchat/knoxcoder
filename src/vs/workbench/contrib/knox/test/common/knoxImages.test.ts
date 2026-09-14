/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	IKnoxImageAttachment,
	KNOX_MAX_IMAGE_BYTES,
	KNOX_MAX_IMAGES,
	knoxDataTransferHasImages,
	knoxImageAttachPlan,
	knoxImageExtension,
	knoxIsAllowedImageMime,
	knoxIsAllowedImageName,
	knoxMessageContentWithImages,
	knoxMimeFromImageName,
	knoxModelSupportsImages,
	knoxParseAddImageAttachment,
	knoxReuseImagesInContent,
	knoxValidateImageFile,
} from '../../common/knoxImages.js';

suite('knox images (T4.5)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('gates vision on capabilities, then provider + model name', () => {
		assert.strictEqual(knoxModelSupportsImages(undefined), false);
		assert.strictEqual(knoxModelSupportsImages({ title: 'Local', provider: 'ollama', model: 'llama3' }), false);
		assert.strictEqual(knoxModelSupportsImages({ title: 'GPT', provider: 'openai', model: 'gpt-4o' }), true);
		assert.strictEqual(knoxModelSupportsImages({ title: 'claude-sonnet', provider: 'anthropic', model: 'x' }), true);
		assert.strictEqual(knoxModelSupportsImages({
			title: 'Forced',
			provider: 'ollama',
			model: 'llama3',
			capabilities: { uploadImage: true },
		}), true);
		assert.strictEqual(knoxModelSupportsImages({
			title: 'Blocked',
			provider: 'openai',
			model: 'gpt-4o',
			capabilities: { uploadImage: false },
		}), false);
	});

	test('accepts the GUI mime and extension allow-list and 10 MB cap', () => {
		assert.ok(knoxIsAllowedImageMime('image/png'));
		assert.ok(knoxIsAllowedImageMime('image/svg'));
		assert.ok(knoxIsAllowedImageName('shot.WEBP'));
		assert.strictEqual(knoxMimeFromImageName('a.JPG'), 'image/jpeg');
		assert.strictEqual(knoxImageExtension('a.png'), 'png');
		assert.strictEqual(knoxValidateImageFile({ mime: 'image/png', sizeBytes: 100, name: 'a.png' }), undefined);
		assert.strictEqual(knoxValidateImageFile({ mime: 'application/pdf', sizeBytes: 100, name: 'a.pdf' }), 'badType');
		assert.strictEqual(knoxValidateImageFile({ mime: 'image/png', sizeBytes: KNOX_MAX_IMAGE_BYTES, name: 'a.png' }), 'tooLarge');
	});

	test('blocks paste/drop when the model has no vision or the cap is full', () => {
		assert.deepStrictEqual(
			knoxImageAttachPlan({ supportsImages: false, currentCount: 0, incomingCount: 1 }),
			{ remaining: 0, block: 'noVision' },
		);
		assert.deepStrictEqual(
			knoxImageAttachPlan({ supportsImages: true, currentCount: KNOX_MAX_IMAGES, incomingCount: 1 }),
			{ remaining: 0, block: 'maxReached' },
		);
		assert.strictEqual(
			knoxImageAttachPlan({ supportsImages: true, currentCount: 8, incomingCount: 5 }).remaining,
			2,
		);
	});

	test('parses addImageAttachment and packs imageUrl parts before text', () => {
		const parsed = knoxParseAddImageAttachment({ imageUrl: 'data:image/png;base64,abc', name: 'screenshot.png' });
		assert.ok(parsed);
		assert.strictEqual(parsed!.src, 'data:image/png;base64,abc');
		assert.strictEqual(parsed!.name, 'screenshot.png');
		assert.ok(parsed!.id.startsWith('img-'));
		assert.strictEqual(knoxParseAddImageAttachment({}), undefined);

		const images: IKnoxImageAttachment[] = [
			{ id: '1', src: 'data:image/png;base64,aa' },
			{ id: '2', src: 'data:image/jpeg;base64,bb', name: 'b.jpg' },
		];
		assert.deepStrictEqual(knoxMessageContentWithImages('hello', images), [
			{ type: 'imageUrl', imageUrl: { url: 'data:image/png;base64,aa' } },
			{ type: 'imageUrl', imageUrl: { url: 'data:image/jpeg;base64,bb' } },
			{ type: 'text', text: 'hello' },
		]);
		assert.strictEqual(knoxMessageContentWithImages('hello', []), 'hello');
		assert.deepStrictEqual(knoxMessageContentWithImages('', images), [
			{ type: 'imageUrl', imageUrl: { url: 'data:image/png;base64,aa' } },
			{ type: 'imageUrl', imageUrl: { url: 'data:image/jpeg;base64,bb' } },
		]);
	});

	test('keeps attached images when a prompt slash command expands the text', () => {
		const previous = knoxMessageContentWithImages('/review src/a.ts', [
			{ id: '1', src: 'data:image/png;base64,aa' },
		]);
		assert.deepStrictEqual(knoxReuseImagesInContent('Review src/a.ts', previous), [
			{ type: 'imageUrl', imageUrl: { url: 'data:image/png;base64,aa' } },
			{ type: 'text', text: 'Review src/a.ts' },
		]);
		assert.strictEqual(knoxReuseImagesInContent('plain', 'plain'), 'plain');
	});

	test('detects image mime types on a data-transfer list', () => {
		assert.strictEqual(knoxDataTransferHasImages(['text/uri-list', 'image/png']), true);
		assert.strictEqual(knoxDataTransferHasImages(['text/plain', 'Files']), false);
	});
});
