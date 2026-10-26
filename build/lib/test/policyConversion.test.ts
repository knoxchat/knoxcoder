/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import { promises as fs } from 'fs';
import path from 'path';
import type { ExportedPolicyDataDto, CategoryDto, PolicyDto } from '../policies/policyDto.ts';
import { BooleanPolicy } from '../policies/booleanPolicy.ts';
import { NumberPolicy } from '../policies/numberPolicy.ts';
import { ObjectPolicy } from '../policies/objectPolicy.ts';
import { StringEnumPolicy } from '../policies/stringEnumPolicy.ts';
import { StringPolicy } from '../policies/stringPolicy.ts';
import type { Policy, ProductJson } from '../policies/types.ts';
import { renderGP, renderMacOSPolicy, renderJsonPolicies } from '../policies/render.ts';
import * as JSONC from 'jsonc-parser';

const PolicyTypes = [
	BooleanPolicy,
	NumberPolicy,
	StringEnumPolicy,
	StringPolicy,
	ObjectPolicy
];

function parsePolicies(policyData: ExportedPolicyDataDto): Policy[] {
	const categories = new Map<string, CategoryDto>();
	for (const category of policyData.categories) {
		categories.set(category.key, category);
	}

	const policies: Policy[] = [];
	for (const policy of policyData.policies) {
		const category = categories.get(policy.category);
		if (!category) {
			throw new Error(`Unknown category: ${policy.category}`);
		}

		let result: Policy | undefined;
		for (const policyType of PolicyTypes) {
			if (result = policyType.from(category, policy)) {
				break;
			}
		}

		if (!result) {
			throw new Error(`Unsupported policy type: ${policy.type} for policy ${policy.name}`);
		}

		policies.push(result);
	}

	// Sort policies first by category name, then by policy name
	policies.sort((a, b) => {
		const categoryCompare = a.category.name.value.localeCompare(b.category.name.value);
		if (categoryCompare !== 0) {
			return categoryCompare;
		}
		return a.name.localeCompare(b.name);
	});

	return policies;
}

/**
 * This is a snapshot of the data taken on Oct. 20 2025 as part of the
 * policy refactor effort. Let's make sure that nothing has regressed.
 */
const policies: ExportedPolicyDataDto = {
	categories: [
		{
			key: 'Extensions',
			name: {
				key: 'extensionsConfigurationTitle',
				value: 'Extensions'
			}
		},
		{
			key: 'Telemetry',
			name: {
				key: 'telemetryConfigurationTitle',
				value: 'Telemetry'
			}
		},
		{
			key: 'Update',
			name: {
				key: 'updateConfigurationTitle',
				value: 'Update'
			}
		}
	],
	policies: [
		{
			key: 'extensions.gallery.serviceUrl',
			name: 'ExtensionGalleryServiceUrl',
			category: 'Extensions',
			minimumVersion: '1.99',
			localization: {
				description: {
					key: 'extensions.gallery.serviceUrl',
					value: 'Configure the Marketplace service URL to connect to'
				}
			},
			type: 'string',
			default: ''
		},
		{
			key: 'extensions.allowed',
			name: 'AllowedExtensions',
			category: 'Extensions',
			minimumVersion: '1.96',
			localization: {
				description: {
					key: 'extensions.allowed.policy',
					value: 'Specify a list of extensions that are allowed to use. This helps maintain a secure and consistent development environment by restricting the use of unauthorized extensions. More information: https://code.visualstudio.com/docs/setup/enterprise#_configure-allowed-extensions'
				}
			},
			type: 'object',
			default: '*'
		},
		{
			key: 'update.mode',
			name: 'UpdateMode',
			category: 'Update',
			minimumVersion: '1.67',
			localization: {
				description: {
					key: 'updateMode',
					value: 'Configure whether you receive automatic updates. Requires a restart after change. The updates are fetched from a Microsoft online service.'
				},
				enumDescriptions: [
					{
						key: 'none',
						value: 'Disable updates.'
					},
					{
						key: 'manual',
						value: 'Disable automatic background update checks. Updates will be available if you manually check for updates.'
					},
					{
						key: 'start',
						value: 'Check for updates only on startup. Disable automatic background update checks.'
					},
					{
						key: 'default',
						value: 'Enable automatic update checks. Code will check for updates automatically and periodically.'
					}
				]
			},
			type: 'string',
			default: 'default',
			enum: [
				'none',
				'manual',
				'start',
				'default'
			]
		},
		{
			key: 'telemetry.telemetryLevel',
			name: 'TelemetryLevel',
			category: 'Telemetry',
			minimumVersion: '1.99',
			localization: {
				description: {
					key: 'telemetry.telemetryLevel.policyDescription',
					value: 'Controls the level of telemetry.'
				},
				enumDescriptions: [
					{
						key: 'telemetry.telemetryLevel.default',
						value: 'Sends usage data, errors, and crash reports.'
					},
					{
						key: 'telemetry.telemetryLevel.error',
						value: 'Sends general error telemetry and crash reports.'
					},
					{
						key: 'telemetry.telemetryLevel.crash',
						value: 'Sends OS level crash reports.'
					},
					{
						key: 'telemetry.telemetryLevel.off',
						value: 'Disables all product telemetry.'
					}
				]
			},
			type: 'string',
			default: 'all',
			enum: [
				'all',
				'error',
				'crash',
				'off'
			]
		},
		{
			key: 'telemetry.feedback.enabled',
			name: 'EnableFeedback',
			category: 'Telemetry',
			minimumVersion: '1.99',
			localization: {
				description: {
					key: 'telemetry.feedback.enabled',
					value: 'Enable feedback mechanisms such as the issue reporter, surveys, and other feedback options.'
				}
			},
			type: 'boolean',
			default: true
		}
	]
};

const mockProduct: ProductJson = {
	nameLong: 'Code - OSS',
	darwinBundleIdentifier: 'com.visualstudio.code.oss',
	darwinProfilePayloadUUID: 'CF808BE7-53F3-46C6-A7E2-7EDB98A5E959',
	darwinProfileUUID: '47827DD9-4734-49A0-AF80-7E19B11495CC',
	win32RegValueName: 'CodeOSS'
};

const frenchTranslations = [
	{
		languageId: 'fr-fr',
		languageTranslations: {
			'': {
				'extensionsConfigurationTitle': 'Extensions',
				'telemetryConfigurationTitle': 'Télémétrie',
				'updateConfigurationTitle': 'Mettre à jour',
				'extensions.allowed.policy': 'Spécifiez une liste d’extensions autorisées. Cela permet de maintenir un environnement de développement sécurisé et cohérent en limitant l’utilisation d’extensions non autorisées. Plus d’informations : https://code.visualstudio.com/docs/setup/enterprise#_configure-allowed-extensions',
				'extensions.gallery.serviceUrl': 'Configurer l’URL du service Place de marché à laquelle se connecter',
				'telemetry.feedback.enabled': 'Activez les mécanismes de commentaires tels que le système de rapport de problèmes, les sondages et autres options de commentaires.',
				'telemetry.telemetryLevel.policyDescription': 'Contrôle le niveau de télémétrie.',
				'telemetry.telemetryLevel.default': `Envoie les données d'utilisation, les erreurs et les rapports d'erreur.`,
				'telemetry.telemetryLevel.error': `Envoie la télémétrie d'erreur générale et les rapports de plantage.`,
				'telemetry.telemetryLevel.crash': `Envoie des rapports de plantage au niveau du système d'exploitation.`,
				'telemetry.telemetryLevel.off': 'Désactive toutes les données de télémétrie du produit.',
				'updateMode': `Choisissez si vous voulez recevoir des mises à jour automatiques. Nécessite un redémarrage après le changement. Les mises à jour sont récupérées auprès d'un service en ligne Microsoft.`,
				'none': 'Aucun',
				'manual': 'Désactivez la recherche de mises à jour automatique en arrière-plan. Les mises à jour sont disponibles si vous les rechercher manuellement.',
				'start': 'Démarrer',
				'default': 'Système'
			}
		}
	}
];

suite('Policy E2E conversion', () => {

	test('should render macOS policy profile from policies list', async () => {
		const parsedPolicies = parsePolicies(policies);
		const result = renderMacOSPolicy(mockProduct, parsedPolicies, []);

		// Load the expected fixture file
		const fixturePath = path.join(import.meta.dirname, 'fixtures', 'policies', 'darwin', 'com.visualstudio.code.oss.mobileconfig');
		const expectedContent = await fs.readFile(fixturePath, 'utf-8');

		// Compare the rendered profile with the fixture
		assert.strictEqual(result.profile, expectedContent, 'macOS policy profile should match the fixture');
	});

	test('should render macOS manifest from policies list', async () => {
		const parsedPolicies = parsePolicies(policies);
		const result = renderMacOSPolicy(mockProduct, parsedPolicies, []);

		// Load the expected fixture file
		const fixturePath = path.join(import.meta.dirname, 'fixtures', 'policies', 'darwin', 'en-us', 'com.visualstudio.code.oss.plist');
		const expectedContent = await fs.readFile(fixturePath, 'utf-8');

		// Find the en-us manifest
		const enUsManifest = result.manifests.find(m => m.languageId === 'en-us');
		assert.ok(enUsManifest, 'en-us manifest should exist');

		// Compare the rendered manifest with the fixture, ignoring the timestamp
		// The pfm_last_modified field contains a timestamp that will differ each time
		const normalizeTimestamp = (content: string) => content.replace(/<date>.*?<\/date>/, '<date>TIMESTAMP</date>');
		assert.strictEqual(
			normalizeTimestamp(enUsManifest.contents),
			normalizeTimestamp(expectedContent),
			'macOS manifest should match the fixture (ignoring timestamp)'
		);
	});

	test('should render Windows ADMX from policies list', async () => {
		const parsedPolicies = parsePolicies(policies);
		const result = renderGP(mockProduct, parsedPolicies, []);

		// Load the expected fixture file
		const fixturePath = path.join(import.meta.dirname, 'fixtures', 'policies', 'win32', 'CodeOSS.admx');
		const expectedContent = await fs.readFile(fixturePath, 'utf-8');

		// Compare the rendered ADMX with the fixture
		assert.strictEqual(result.admx, expectedContent, 'Windows ADMX should match the fixture');
	});

	test('should render Windows ADML from policies list', async () => {
		const parsedPolicies = parsePolicies(policies);
		const result = renderGP(mockProduct, parsedPolicies, []);

		// Load the expected fixture file
		const fixturePath = path.join(import.meta.dirname, 'fixtures', 'policies', 'win32', 'en-us', 'CodeOSS.adml');
		const expectedContent = await fs.readFile(fixturePath, 'utf-8');

		// Find the en-us ADML
		const enUsAdml = result.adml.find(a => a.languageId === 'en-us');
		assert.ok(enUsAdml, 'en-us ADML should exist');

		// Compare the rendered ADML with the fixture
		assert.strictEqual(enUsAdml.contents, expectedContent, 'Windows ADML should match the fixture');
	});

	test('should render macOS manifest with fr-fr locale', async () => {
		const parsedPolicies = parsePolicies(policies);
		const result = renderMacOSPolicy(mockProduct, parsedPolicies, frenchTranslations);

		// Load the expected fixture file
		const fixturePath = path.join(import.meta.dirname, 'fixtures', 'policies', 'darwin', 'fr-fr', 'com.visualstudio.code.oss.plist');
		const expectedContent = await fs.readFile(fixturePath, 'utf-8');

		// Find the fr-fr manifest
		const frFrManifest = result.manifests.find(m => m.languageId === 'fr-fr');
		assert.ok(frFrManifest, 'fr-fr manifest should exist');

		// Compare the rendered manifest with the fixture, ignoring the timestamp
		const normalizeTimestamp = (content: string) => content.replace(/<date>.*?<\/date>/, '<date>TIMESTAMP</date>');
		assert.strictEqual(
			normalizeTimestamp(frFrManifest.contents),
			normalizeTimestamp(expectedContent),
			'macOS fr-fr manifest should match the fixture (ignoring timestamp)'
		);
	});

	test('should render Windows ADML with fr-fr locale', async () => {
		const parsedPolicies = parsePolicies(policies);
		const result = renderGP(mockProduct, parsedPolicies, frenchTranslations);

		// Load the expected fixture file
		const fixturePath = path.join(import.meta.dirname, 'fixtures', 'policies', 'win32', 'fr-fr', 'CodeOSS.adml');
		const expectedContent = await fs.readFile(fixturePath, 'utf-8');

		// Find the fr-fr ADML
		const frFrAdml = result.adml.find(a => a.languageId === 'fr-fr');
		assert.ok(frFrAdml, 'fr-fr ADML should exist');

		// Compare the rendered ADML with the fixture
		assert.strictEqual(frFrAdml.contents, expectedContent, 'Windows fr-fr ADML should match the fixture');
	});

	test('should render Linux policy JSON from policies list', async () => {
		const parsedPolicies = parsePolicies(policies);
		const result = renderJsonPolicies(parsedPolicies);

		// Load the expected fixture file
		const fixturePath = path.join(import.meta.dirname, 'fixtures', 'policies', 'linux', 'policy.json');
		const expectedContent = await fs.readFile(fixturePath, 'utf-8');
		const expectedJson = JSON.parse(expectedContent);

		// Compare the rendered JSON with the fixture
		assert.deepStrictEqual(result, expectedJson, 'Linux policy JSON should match the fixture');
	});

	test('should successfully parse the checked-in policyData.jsonc', async () => {
		const policyDataPath = path.join(import.meta.dirname, '..', 'policies', 'policyData.jsonc');
		const raw = await fs.readFile(policyDataPath, 'utf-8');
		const errors: JSONC.ParseError[] = [];
		const policyData: ExportedPolicyDataDto = JSONC.parse(raw, errors);

		assert.strictEqual(errors.length, 0, `policyData.jsonc should be valid JSONC: ${JSON.stringify(errors)}`);
		// This exercises StringEnumPolicy.from() validation, which requires
		// enumDescriptions to exist and match enum length for string enum policies.
		const parsed = parsePolicies(policyData);
		assert.ok(parsed.length > 0, 'Should parse at least one policy from policyData.jsonc');
	});

	test('ObjectPolicy.from accepts a union type (e.g. array | null)', () => {
		const category: CategoryDto = { key: 'Extensions', name: { key: 'Extensions', value: 'Extensions' } };
		const policy: PolicyDto = {
			key: 'extensions.allowed',
			name: 'AllowedExtensions',
			category: 'Extensions',
			minimumVersion: '1.0',
			localization: { description: { key: 'desc', value: 'desc' } },
			type: ['array', 'null'],
			default: null,
		};
		assert.ok(ObjectPolicy.from(category, policy), 'A union array|null type should be classified as an object policy');
	});

	test('descriptions containing angle brackets are escaped in ADML output (#320551)', () => {
		const policyData: ExportedPolicyDataDto = {
			categories: [{ key: 'Extensions', name: { key: 'extensionsConfigurationTitle', value: 'Extensions' } }],
			policies: [
				{
					key: 'extensions.allowed',
					name: 'AllowedExtensions',
					category: 'Extensions',
					minimumVersion: '1.122',
					localization: {
						description: {
							key: 'extensions.allowed.policy',
							value: 'Allowed extensions. Keys are extension IDs in `<publisher>.<name>` form; values enable or disable the extension.'
						}
					},
					type: 'object',
					default: {},
				},
				{
					key: 'extensions.gallery.serviceUrl',
					name: 'ExtensionGalleryServiceUrl',
					category: 'Extensions',
					minimumVersion: '1.122',
					localization: {
						description: {
							key: 'extensions.gallery.serviceUrl',
							value: 'Configure the Marketplace service URL to connect to `<url>` endpoints.'
						}
					},
					type: 'object',
					default: {},
				}
			]
		};

		const parsed = parsePolicies(policyData);
		const { adml } = renderGP(mockProduct, parsed, []);
		const enUs = adml.find(a => a.languageId === 'en-us');
		assert.ok(enUs, 'en-us ADML should exist');

		// Angle brackets must be escaped so the output is valid XML
		assert.ok(enUs.contents.includes('&lt;publisher&gt;.&lt;name&gt;'), 'angle brackets in descriptions must be XML-escaped');
		assert.ok(enUs.contents.includes('&lt;url&gt;'), 'angle brackets in descriptions must be XML-escaped');
		assert.ok(!enUs.contents.includes('<publisher>'), 'raw angle brackets must not appear in ADML output');
		assert.ok(!enUs.contents.includes('<url>'), 'raw angle brackets must not appear in ADML output');
	});


});
