'use strict';

/**
 * typescript-eslint 8 refuses to load TypeScript >= 7. package.json "overrides"
 * pin it to @typescript/typescript6, but a dirty node_modules tree still resolves
 * the root typescript@7 package. Redirect those requires to TS 6.
 */
const Module = require('module');
const path = require('path');

const orig = Module._resolveFilename;
const ts6Root = path.resolve(__dirname, '..', 'node_modules', '@typescript', 'typescript6');

function fromEslint(parent) {
	const filename = parent && parent.filename;
	return typeof filename === 'string' && /(?:^|[\\/])(?:typescript-eslint|@typescript-eslint|ts-api-utils)(?:[\\/]|$)/.test(filename);
}

Module._resolveFilename = function (request, parent, isMain, options) {
	if (fromEslint(parent)) {
		if (request === 'typescript') {
			return orig.call(this, path.join(ts6Root, 'lib', 'typescript.js'), parent, isMain, options);
		}
		if (request === 'typescript/package.json') {
			return path.join(ts6Root, 'package.json');
		}
		if (typeof request === 'string' && request.startsWith('typescript/')) {
			return orig.call(this, path.join(ts6Root, request.slice('typescript/'.length)), parent, isMain, options);
		}
	}
	return orig.call(this, request, parent, isMain, options);
};
