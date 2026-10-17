/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mocha = require('mocha');
const FullJsonStreamReporter = require('./fullJsonStreamReporter');
const path = require('path');

function parseReporterOption(value) {
	const r = /^([^=]+)=(.*)$/.exec(value);
	return r ? { [r[1]]: r[2] } : {};
}

function reporterNameVariants(name) {
	if (!name) {
		return [];
	}
	const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
	return [...new Set([name, capitalized])];
}

/**
 * Mocha 12 reporters are ESM (`export { Spec }`). `require()` of those files
 * returns a module namespace, not a constructor. Prefer mocha.reporters CJS
 * aliases (`spec` / `Spec`) and unwrap `{ default }` / named exports.
 */
function asReporterConstructor(mod, name) {
	if (typeof mod === 'function') {
		return mod;
	}
	if (!mod || typeof mod !== 'object') {
		return undefined;
	}
	if (typeof mod.default === 'function') {
		return mod.default;
	}
	for (const key of reporterNameVariants(name)) {
		if (typeof mod[key] === 'function') {
			return mod[key];
		}
	}
	return undefined;
}

exports.importMochaReporter = name => {
	if (name === 'full-json-stream') {
		return FullJsonStreamReporter;
	}

	const builtin = asReporterConstructor(mocha.reporters, name);
	if (builtin) {
		return builtin;
	}

	const reporterPath = path.join(path.dirname(require.resolve('mocha')), 'lib', 'reporters', name);
	const loaded = asReporterConstructor(require(reporterPath), name);
	if (loaded) {
		return loaded;
	}
	throw new TypeError(`Mocha reporter '${name}' is not a constructor`);
};

exports.applyReporter = (runner, argv) => {
	let Reporter;
	try {
		Reporter = exports.importMochaReporter(argv.reporter);
	} catch (err) {
		try {
			Reporter = asReporterConstructor(require(argv.reporter), path.basename(String(argv.reporter), path.extname(String(argv.reporter))));
			if (!Reporter) {
				throw new TypeError(`Mocha reporter '${argv.reporter}' is not a constructor`);
			}
		} catch (err) {
			Reporter = process.platform === 'win32' ? mocha.reporters.List : mocha.reporters.Spec;
			console.warn(`could not load reporter: ${argv.reporter}, using ${Reporter.name}`);
		}
	}

	let reporterOptions = argv['reporter-options'];
	reporterOptions = typeof reporterOptions === 'string' ? [reporterOptions] : reporterOptions;
	reporterOptions = reporterOptions.reduce((r, o) => Object.assign(r, parseReporterOption(o)), {});

	return new Reporter(runner, { reporterOptions });
};
