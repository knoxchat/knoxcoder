/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService, IFileStatResult, IFileStat } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService, WorkbenchState, IWorkspace } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { ITextFileService, ITextFileContent } from '../../../services/textfile/common/textfiles.js';
import { URI } from '../../../../base/common/uri.js';
import { Schemas } from '../../../../base/common/network.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkspaceTagsService, Tags } from '../common/workspaceTags.js';
import { getHashedRemotesFromConfig } from './workspaceTags.js';
import { splitLines } from '../../../../base/common/strings.js';
import { MavenArtifactIdRegex, MavenDependenciesRegex, MavenDependencyRegex, GradleDependencyCompactRegex, GradleDependencyLooseRegex, MavenGroupIdRegex, JavaLibrariesToLookFor } from '../common/javaWorkspaceTags.js';
import { hashAsync } from '../../../../base/common/hash.js';

const ModulesToLookFor = [
	// Platform-related type definition packages
	'@types/vscode',
	'@vscode/dts',
	'@types/node',
	'@types/bun',
	'bun-types',
	'@types/web',
	// Packages that suggest a JS-based backend server
	'express',
	'sails',
	'koa',
	'hapi',
	'socket.io',
	'restify',
	'next',
	'nuxt',
	'@nestjs/core',
	'strapi',
	'gatsby',
	'fastify',
	'hono',
	// JS frameworks
	'react',
	'react-native',
	'react-native-macos',
	'react-native-windows',
	'rnpm-plugin-windows',
	'@types/react',
	'@angular/core',
	'@ionic',
	'vue',
	'tns-core-modules',
	'@nativescript/core',
	'electron',
	'@remix-run/react',
	'@remix-run/express',
	'@remix-run/node',
	'@remix-run/dev',
	'@sveltejs/kit',
	'preact',
	'@preact/signals',
	'@builder.io/qwik',
	'alpinejs',
	'astro',
	'htmx.org',
	'solid-js',
	'svelte',
	'lit-html',
	'vuepress',
	// Other interesting packages
	'aws-sdk',
	'aws-amplify',
	'chroma',
	'deepseek-js',
	'docusaurus',
	'faiss',
	'firebase',
	'@google-cloud/common',
	'heroku-cli',
	'langchain',
	'milvus',
	'openai',
	'pinecone',
	'praisonai',
	'qdrant',
	'typescript',
	'@typescript/native',
	'@typescript/native-preview',
	'tslib',
	'eslint',
	'oxlint',
	'oxfmt',
	'typescript-eslint',
	'prettier',
	'dprint',
	'@dprint/formatter',
	'@babel/cli',
	'@babel/core',
	'@swc/cli',
	'@swc/core',
	'vite',
	'esbuild',
	'rollup',
	'rolldown',
	'nx',
	'turbo',
	'webpack',
	'parcel',
	'@biomejs/biome',
	'@rspack/core',
	'@rspack/cli',
	'@trpc/client',
	'@trpc/server',
	'zod',
	'pyright',
	'ts-morph',
	'oxc-minify',
	'oxc-transform',
	'oxc-resolver',
	'vue-tsc',
	'svelte-check',
	'tsup',
	'tsdown',
	// Office and Sharepoint packages
	'@microsoft/teams-js',
	'@microsoft/office-js',
	'@microsoft/office-js-helpers',
	'@types/office-js',
	'@types/office-runtime',
	'office-ui-fabric-react',
	'@uifabric/icons',
	'@uifabric/merge-styles',
	'@uifabric/styling',
	'@uifabric/experiments',
	'@uifabric/utilities',
	'@microsoft/rush',
	'lerna',
	'just-task',
	'beachball',
	// Playwright packages
	'playwright',
	'playwright-cli',
	'@playwright/test',
	'playwright-core',
	'playwright-chromium',
	'playwright-firefox',
	'playwright-webkit',
	// Other interesting browser testing packages
	'chai',
	'cypress',
	'gherkin',
	'jest',
	'mocha',
	'nightwatch',
	'protractor',
	'puppeteer',
	'selenium-webdriver',
	'vitest',
	'webdriverio',
];

const PyModulesToLookFor = [
	'a2a-sdk',
	'adal',
	'agents',
	'pydocumentdb',
	'botbuilder-core',
	'botbuilder-schema',
	'botframework-connector',
	'codegen',
	'deepseek',
	'google-adk',
	'playwright',
	'praisonai',
	'pydantic-ai',
	'python-rai',
	'transformers',
	'langchain',
	'llama-index',
	'google-cloud-aiplatform',
	'guidance',
	'openai',
	'semantic-kernel',
	'sentence-transformers',
	'smolagents',
	'stripe-agent-toolkit',
	// AI and vector db dev packages
	'anthropic',
	'aporia',
	'arize',
	'deepchecks',
	'fireworks-ai',
	'langchain-fireworks',
	'humanloop',
	'pymongo',
	'langchain-anthropic',
	'langchain-huggingface',
	'langchain-fireworks',
	'ollama',
	'onnxruntime',
	'pgvector',
	'sentence-transformers',
	'tika',
	'trulens',
	'trulens-eval',
	'wandb',
	'google-generativeai'
];

export class WorkspaceTagsService implements IWorkspaceTagsService {
	declare readonly _serviceBrand: undefined;
	private _tags: Tags | undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@ITextFileService private readonly textFileService: ITextFileService
	) { }

	async getTags(): Promise<Tags> {
		if (!this._tags) {
			this._tags = await this.resolveWorkspaceTags();
		}

		return this._tags;
	}

	async getTelemetryWorkspaceId(workspace: IWorkspace, state: WorkbenchState): Promise<string | undefined> {
		function createHash(uri: URI): Promise<string> {
			return hashAsync(uri.scheme === Schemas.file ? uri.fsPath : uri.toString());
		}

		let workspaceId: string | undefined;
		switch (state) {
			case WorkbenchState.EMPTY:
				workspaceId = undefined;
				break;
			case WorkbenchState.FOLDER:
				workspaceId = await createHash(workspace.folders[0].uri);
				break;
			case WorkbenchState.WORKSPACE:
				if (workspace.configuration) {
					workspaceId = await createHash(workspace.configuration);
				}
		}

		return workspaceId;
	}

	getHashedRemotesFromUri(workspaceUri: URI, stripEndingDotGit: boolean = false): Promise<string[]> {
		const path = workspaceUri.path;
		const uri = workspaceUri.with({ path: `${path !== '/' ? path : ''}/.git/config` });
		return this.fileService.exists(uri).then(exists => {
			if (!exists) {
				return [];
			}
			return this.textFileService.read(uri, { acceptTextOnly: true }).then(
				content => getHashedRemotesFromConfig(content.value, stripEndingDotGit),
				err => [] // ignore missing or binary file
			);
		});
	}

	/* __GDPR__FRAGMENT__
		"WorkspaceTags" : {
			"workbench.filesToOpenOrCreate" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workbench.filesToDiff" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workbench.filesToMerge" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.id" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
			"workspace.roots" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.empty" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.grunt" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gulp" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.jake" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.tsconfig" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.jsconfig" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.config.xml" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.vsc.extension" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.asp<NUMBER>" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.sln" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.unity" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.express" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.sails" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.koa" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.hapi" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.socket.io" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.restify" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.next" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.nuxt" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@nestjs/core" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.strapi" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.gatsby" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.rnpm-plugin-windows" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.react" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@angular/core" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.vue" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.aws-sdk" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.aws-amplify-sdk" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@google-cloud/common" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.firebase" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.heroku-cli" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@microsoft/teams-js" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@microsoft/office-js" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@microsoft/office-js-helpers" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@types/office-js" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@types/office-runtime" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.office-ui-fabric-react" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/icons" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/merge-styles" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/styling" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/experiments" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/utilities" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@microsoft/rush" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.lerna" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.just-task" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.beachball" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.electron" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.playwright" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.playwright-cli" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@playwright/test" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.playwright-core" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.playwright-chromium" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.playwright-firefox" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.playwright-webkit" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.cypress" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.chroma" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.faiss" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.langchain" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.milvus" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.openai" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.pinecone" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.qdrant" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.nightwatch" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.protractor" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.puppeteer" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.selenium-webdriver" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.webdriverio" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.gherkin" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@types/vscode" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@vscode/dts" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@types/node" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@types/bun" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.bun-types" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@types/web" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.fastify" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.hono" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@types/react" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@remix-run/react" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@remix-run/express" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@remix-run/node" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@remix-run/dev" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@sveltejs/kit" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.preact" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@preact/signals" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@builder.io/qwik" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.alpinejs" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.astro" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.htmx.org" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.solid-js" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.svelte" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.lit-html" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.vuepress" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.docusaurus" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.typescript" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@typescript/native" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@typescript/native-preview" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.tslib" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.eslint" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.oxlint" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.oxfmt" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.typescript-eslint" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.prettier" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.dprint" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@dprint/formatter" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@babel/cli" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@babel/core" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@swc/cli" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@swc/core" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.vite" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.esbuild" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.rollup" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.rolldown" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.nx" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.turbo" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.webpack" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.parcel" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@biomejs/biome" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@rspack/core" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@rspack/cli" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@trpc/client" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@trpc/server" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.zod" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.pyright" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.ts-morph" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.oxc-minify" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.oxc-transform" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.oxc-resolver" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.vue-tsc" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.svelte-check" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.tsup" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.tsdown" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.chai" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.jest" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.mocha" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.vitest" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.react-native-macos" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.react-native-windows" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.bower" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.yeoman.code.ext" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.cordova.high" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.cordova.low" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.xamarin.android" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.xamarin.ios" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.android.cpp" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.reactNative" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.ionic" : { "classification" : "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": "true" },
			"workspace.nativeScript" : { "classification" : "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": "true" },
			"workspace.java.pom" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.java.gradle" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.java.android" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.javaee" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.jdbc" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.jpa" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.lombok" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.mockito" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.redis" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.springboot" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.sql" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.unittest" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-cosmos" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-storage" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-servicebus" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-eventhubs" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.langchain4j" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.springboot-ai" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.semantic-kernel" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-ai-anomalydetector" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-ai-formrecognizer" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-ai-documentintelligence" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-ai-translation-document" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-ai-personalizer" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-ai-translation-text" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-ai-contentsafety" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-ai-vision-imageanalysis" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-ai-textanalytics" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-search-documents" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-ai-documenttranslator" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-ai-vision-face" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-ai-openai-assistants" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-cognitiveservices" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-cognitiveservices-speech" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.openai" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-openai" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.azure-functions" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.quarkus" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.microprofile" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.micronaut" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gradle.graalvm" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.javaee" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.jdbc" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.jpa" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.lombok" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.mockito" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.redis" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.springboot" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.sql" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.unittest" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-cosmos" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-storage" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-servicebus" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-eventhubs" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.langchain4j" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.springboot-ai" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.semantic-kernel" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-ai-anomalydetector" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-ai-formrecognizer" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-ai-documentintelligence" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-ai-translation-document" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-ai-personalizer" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-ai-translation-text" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-ai-contentsafety" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-ai-vision-imageanalysis" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-ai-textanalytics" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-search-documents" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-ai-documenttranslator" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-ai-vision-face" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-ai-openai-assistants" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-cognitiveservices" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-cognitiveservices-speech" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.openai" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-openai" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.azure-functions" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.quarkus" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.microprofile" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.micronaut" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.pom.graalvm" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.requirements" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.requirements.star" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.Pipfile" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.conda" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.setup": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.pyproject": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.manage": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.setupcfg": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.app": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.adal" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.pydocumentdb" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.botbuilder-core" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.botbuilder-schema" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.botframework-connector" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.playwright" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.arize" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.aporia" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.anthropic" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.deepchecks" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.fireworks-ai" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.transformers" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.humanloop" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.langchain" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.langchain-anthropic" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.langchain-fireworks" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.langchain-huggingface" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.llama-index" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.google-cloud-aiplatform" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.guidance" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.ollama" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.onnxruntime" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.openai" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.pymongo" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.pgvector" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.semantic-kernel" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.sentence-transformers" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.tika" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.trulens" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.trulens-eval" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.wandb" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.google-generativeai" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
		}
	*/
	private async resolveWorkspaceTags(): Promise<Tags> {
		const tags: Tags = Object.create(null);

		const state = this.contextService.getWorkbenchState();
		const workspace = this.contextService.getWorkspace();

		tags['workspace.id'] = await this.getTelemetryWorkspaceId(workspace, state);

		const { filesToOpenOrCreate, filesToDiff, filesToMerge } = this.environmentService;
		tags['workbench.filesToOpenOrCreate'] = filesToOpenOrCreate && filesToOpenOrCreate.length || 0;
		tags['workbench.filesToDiff'] = filesToDiff && filesToDiff.length || 0;
		tags['workbench.filesToMerge'] = filesToMerge && filesToMerge.length || 0;

		const isEmpty = state === WorkbenchState.EMPTY;
		tags['workspace.roots'] = isEmpty ? 0 : workspace.folders.length;
		tags['workspace.empty'] = isEmpty;

		const folders = !isEmpty ? workspace.folders.map(folder => folder.uri) : undefined;
		if (!folders || !folders.length) {
			return Promise.resolve(tags);
		}

		const aiGeneratedWorkspaces = URI.joinPath(this.environmentService.workspaceStorageHome, 'aiGeneratedWorkspaces.json');
		await this.fileService.exists(aiGeneratedWorkspaces).then(async result => {
			if (result) {
				try {
					const content = await this.fileService.readFile(aiGeneratedWorkspaces);
					const workspaces = JSON.parse(content.value.toString()) as string[];
					if (workspaces.indexOf(workspace.folders[0].uri.toString()) > -1) {
						tags.aiGenerated = true;
					}
				} catch (e) {
					// Ignore errors when resolving file contents
				}
			}
		});

		return this.fileService.resolveAll(folders.map(resource => ({ resource }))).then((files: IFileStatResult[]) => {
			const names = (<IFileStat[]>[]).concat(...files.map(result => result.success ? (result.stat!.children || []) : [])).map(c => c.name);
			const nameSet = names.reduce((s, n) => s.add(n.toLowerCase()), new Set());

			tags['workspace.grunt'] = nameSet.has('gruntfile.js');
			tags['workspace.gulp'] = nameSet.has('gulpfile.js');
			tags['workspace.jake'] = nameSet.has('jakefile.js');

			tags['workspace.tsconfig'] = nameSet.has('tsconfig.json');
			tags['workspace.jsconfig'] = nameSet.has('jsconfig.json');
			tags['workspace.config.xml'] = nameSet.has('config.xml');
			tags['workspace.vsc.extension'] = nameSet.has('vsc-extension-quickstart.md');

			tags['workspace.ASP5'] = nameSet.has('project.json') && this.searchArray(names, /^.+\.cs$/i);
			tags['workspace.sln'] = this.searchArray(names, /^.+\.sln$|^.+\.csproj$/i);
			tags['workspace.unity'] = nameSet.has('assets') && nameSet.has('library') && nameSet.has('projectsettings');
			tags['workspace.npm'] = nameSet.has('package.json') || nameSet.has('node_modules');
			tags['workspace.bower'] = nameSet.has('bower.json') || nameSet.has('bower_components');


			tags['workspace.java.pom'] = nameSet.has('pom.xml');
			tags['workspace.java.gradle'] = nameSet.has('build.gradle') || nameSet.has('settings.gradle') || nameSet.has('build.gradle.kts') || nameSet.has('settings.gradle.kts') || nameSet.has('gradlew') || nameSet.has('gradlew.bat');

			tags['workspace.yeoman.code.ext'] = nameSet.has('vsc-extension-quickstart.md');

			tags['workspace.py.requirements'] = nameSet.has('requirements.txt');
			tags['workspace.py.requirements.star'] = this.searchArray(names, /^(.*)requirements(.*)\.txt$/i);
			tags['workspace.py.Pipfile'] = nameSet.has('pipfile');
			tags['workspace.py.conda'] = this.searchArray(names, /^environment(\.yml$|\.yaml$)/i);
			tags['workspace.py.setup'] = nameSet.has('setup.py');
			tags['workspace.py.manage'] = nameSet.has('manage.py');
			tags['workspace.py.setupcfg'] = nameSet.has('setup.cfg');
			tags['workspace.py.app'] = nameSet.has('app.py');
			tags['workspace.py.pyproject'] = nameSet.has('pyproject.toml');

			tags['workspace.go.mod'] = nameSet.has('go.mod');

			const mainActivity = nameSet.has('mainactivity.cs') || nameSet.has('mainactivity.fs');
			const appDelegate = nameSet.has('appdelegate.cs') || nameSet.has('appdelegate.fs');
			const androidManifest = nameSet.has('androidmanifest.xml');

			const platforms = nameSet.has('platforms');
			const plugins = nameSet.has('plugins');
			const www = nameSet.has('www');
			const properties = nameSet.has('properties');
			const resources = nameSet.has('resources');
			const jni = nameSet.has('jni');

			if (tags['workspace.config.xml'] &&
				!tags['workspace.language.cs'] && !tags['workspace.language.vb'] && !tags['workspace.language.aspx']) {
				if (platforms && plugins && www) {
					tags['workspace.cordova.high'] = true;
				} else {
					tags['workspace.cordova.low'] = true;
				}
			}

			if (tags['workspace.config.xml'] &&
				!tags['workspace.language.cs'] && !tags['workspace.language.vb'] && !tags['workspace.language.aspx']) {

				if (nameSet.has('ionic.config.json')) {
					tags['workspace.ionic'] = true;
				}
			}

			if (mainActivity && properties && resources) {
				tags['workspace.xamarin.android'] = true;
			}

			if (appDelegate && resources) {
				tags['workspace.xamarin.ios'] = true;
			}

			if (androidManifest && jni) {
				tags['workspace.android.cpp'] = true;
			}

			function getFilePromises(filename: string, fileService: IFileService, textFileService: ITextFileService, contentHandler: (content: ITextFileContent) => void): Promise<void>[] {
				return !nameSet.has(filename) ? [] : (folders as URI[]).map(workspaceUri => {
					const uri = workspaceUri.with({ path: `${workspaceUri.path !== '/' ? workspaceUri.path : ''}/${filename}` });
					return fileService.exists(uri).then(exists => {
						if (!exists) {
							return undefined;
						}

						return textFileService.read(uri, { acceptTextOnly: true }).then(contentHandler);
					}, err => {
						// Ignore missing file
					});
				});
			}

			function addPythonTags(packageName: string): void {
				if (PyModulesToLookFor.indexOf(packageName) > -1) {
					tags['workspace.py.' + packageName] = true;
				}
			}

			const requirementsTxtPromises = getFilePromises('requirements.txt', this.fileService, this.textFileService, content => {
				const dependencies: string[] = splitLines(content.value);
				for (const dependency of dependencies) {
					// Dependencies in requirements.txt can have 3 formats: `foo==3.1, foo>=3.1, foo`
					const format1 = dependency.split('==');
					const format2 = dependency.split('>=');
					const packageName = (format1.length === 2 ? format1[0] : format2[0]).trim();
					addPythonTags(packageName);
				}
			});

			const pipfilePromises = getFilePromises('pipfile', this.fileService, this.textFileService, content => {
				let dependencies: string[] = splitLines(content.value);

				// We're only interested in the '[packages]' section of the Pipfile
				dependencies = dependencies.slice(dependencies.indexOf('[packages]') + 1);

				for (const dependency of dependencies) {
					if (dependency.trim().indexOf('[') > -1) {
						break;
					}
					// All dependencies in Pipfiles follow the format: `<package> = <version, or git repo, or something else>`
					if (dependency.indexOf('=') === -1) {
						continue;
					}
					const packageName = dependency.split('=')[0].trim();
					addPythonTags(packageName);
				}

			});

			const packageJsonPromises = getFilePromises('package.json', this.fileService, this.textFileService, content => {
				try {
					const packageJsonContents = JSON.parse(content.value);
					const dependencies = Object.keys(packageJsonContents.dependencies || {}).concat(Object.keys(packageJsonContents.devDependencies || {}));

					for (const dependency of dependencies) {
						if (dependency.startsWith('react-native')) {
							tags['workspace.reactNative'] = true;
						} else if ('tns-core-modules' === dependency || '@nativescript/core' === dependency) {
							tags['workspace.nativescript'] = true;
						} else if (ModulesToLookFor.indexOf(dependency) > -1) {
							tags['workspace.npm.' + dependency] = true;
						}
					}
				}
				catch (e) {
					// Ignore errors when resolving file or parsing file contents
				}
			});

			const pomPromises = getFilePromises('pom.xml', this.fileService, this.textFileService, content => {
				try {
					let dependenciesContent;
					while (dependenciesContent = MavenDependenciesRegex.exec(content.value)) {
						let dependencyContent;
						while (dependencyContent = MavenDependencyRegex.exec(dependenciesContent[1])) {
							const groupIdContent = MavenGroupIdRegex.exec(dependencyContent[1]);
							const artifactIdContent = MavenArtifactIdRegex.exec(dependencyContent[1]);
							if (groupIdContent && artifactIdContent) {
								this.tagJavaDependency(groupIdContent[1], artifactIdContent[1], 'workspace.pom.', tags);
							}
						}
					}
				}
				catch (e) {
					// Ignore errors when resolving maven dependencies
				}
			});

			const gradlePromises = getFilePromises('build.gradle', this.fileService, this.textFileService, content => {
				try {
					this.processGradleDependencies(content.value, GradleDependencyLooseRegex, tags);
					this.processGradleDependencies(content.value, GradleDependencyCompactRegex, tags);
				}
				catch (e) {
					// Ignore errors when resolving gradle dependencies
				}
			});

			const androidPromises = folders.map(workspaceUri => {
				const manifest = URI.joinPath(workspaceUri, '/app/src/main/AndroidManifest.xml');
				return this.fileService.exists(manifest).then(result => {
					if (result) {
						tags['workspace.java.android'] = true;
					}
				}, err => {
					// Ignore errors when resolving android
				});
			});

			return Promise.all([...packageJsonPromises, ...requirementsTxtPromises, ...pipfilePromises, ...pomPromises, ...gradlePromises, ...androidPromises]).then(() => tags);
		});
	}

	private processGradleDependencies(content: string, regex: RegExp, tags: Tags): void {
		let dependencyContent;
		while (dependencyContent = regex.exec(content)) {
			const groupId = dependencyContent[1];
			const artifactId = dependencyContent[2];
			if (groupId && artifactId) {
				this.tagJavaDependency(groupId, artifactId, 'workspace.gradle.', tags);
			}
		}
	}

	private tagJavaDependency(groupId: string, artifactId: string, prefix: string, tags: Tags): void {
		for (const javaLibrary of JavaLibrariesToLookFor) {
			if (javaLibrary.predicate(groupId, artifactId)) {
				tags[prefix + javaLibrary.tag] = true;
				return;
			}
		}
	}

	private searchArray(arr: string[], regEx: RegExp): boolean | undefined {
		return arr.some(v => v.search(regEx) > -1) || undefined;
	}
}

registerSingleton(IWorkspaceTagsService, WorkspaceTagsService, InstantiationType.Delayed);
