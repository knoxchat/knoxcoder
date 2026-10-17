/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { NoopTelemetryReporter } from './common/noopTelemetryReporter';
import { Keychain } from './common/keychain';
import { GitHubServer, IGitHubServer, IGitHubToken } from './githubServer';
import { PromiseAdapter, arrayEquals, promiseFromEvent } from './common/utils';
import { ExperimentationTelemetry } from './common/experimentationService';
import { Log } from './common/logger';
import { IGitHubUserInfo } from './common/gitHubAccount';
import { crypto } from './node/crypto';
import { TIMED_OUT_ERROR, USER_CANCELLATION_ERROR } from './common/errors';
import { isSignInProvider, type GitHubSignInProvider } from './flows';
import { getEnterpriseUriKey } from './common/enterpriseStorage';

// `vscode` doesn't publicly export `UriComponents`, so derive the exact shape from `Uri.from`.
type UriComponents = Parameters<typeof vscode.Uri.from>[0];

interface SessionData {
	id: string;
	account?: {
		label?: string;
		displayName?: string;
		// Unfortunately, for some time the id was a number, so we need to support both.
		// This can be removed once we are confident that all users have migrated to the new id.
		id: string | number;
		icon?: UriComponents;
	};
	scopes: string[];
	accessToken: string;
	authorizationServer?: UriComponents;
}

export enum AuthProviderType {
	github = 'github',
	githubEnterprise = 'github-enterprise'
}

interface GitHubAuthenticationProviderOptions extends vscode.AuthenticationProviderSessionOptions {
	/**
	 * This is specific to GitHub and is used to determine which sign-in provider to use.
	 * If not provided, the default (GitHub) is used which shows all options.
	 *
	 * Example: If you specify Google, then the sign-in flow will skip the initial page that asks you
	 * to choose how you want to sign in and will directly take you to the Google sign-in page.
	 *
	 * This allows us to show "Continue with Google" buttons in the product, rather than always
	 * leaving it up to the user to choose the sign-in provider on the sign-in page.
	 */
	readonly provider?: GitHubSignInProvider;
	readonly extraAuthorizeParameters?: Record<string, string>;
}

function isGitHubAuthenticationProviderOptions(object: unknown): object is GitHubAuthenticationProviderOptions {
	if (!object || typeof object !== 'object') {
		throw new Error('Options are not an object');
	}
	const { provider, extraAuthorizeParameters } = object as GitHubAuthenticationProviderOptions;
	if (provider !== undefined && !isSignInProvider(provider)) {
		throw new Error(`Provider is invalid: ${provider}`);
	}
	if (extraAuthorizeParameters !== undefined) {
		if (!extraAuthorizeParameters || typeof extraAuthorizeParameters !== 'object') {
			throw new Error('Extra parameters must be a record of string keys and string values.');
		}
		for (const [key, value] of Object.entries(extraAuthorizeParameters)) {
			if (typeof key !== 'string' || typeof value !== 'string') {
				throw new Error('Extra parameters must be a record of string keys and string values.');
			}
		}
	}
	return true;
}

export class UriEventHandler extends vscode.EventEmitter<vscode.Uri> implements vscode.UriHandler {
	private readonly _pendingNonces = new Map<string, string[]>();
	private readonly _codeExchangePromises = new Map<string, { promise: Promise<string>; cancel: vscode.EventEmitter<void> }>();

	public handleUri(uri: vscode.Uri) {
		this.fire(uri);
	}

	public async waitForCode(logger: Log, scopes: string, nonce: string, token: vscode.CancellationToken, baseUri: vscode.Uri) {
		const scopeKey = `${baseUri.toString()} ${scopes}`;
		const existingNonces = this._pendingNonces.get(scopeKey) || [];
		this._pendingNonces.set(scopeKey, [...existingNonces, nonce]);

		let codeExchangePromise = this._codeExchangePromises.get(scopeKey);
		if (!codeExchangePromise) {
			codeExchangePromise = promiseFromEvent(this.event, this.handleEvent(logger, scopeKey));
			this._codeExchangePromises.set(scopeKey, codeExchangePromise);
		}

		try {
			return await Promise.race([
				codeExchangePromise.promise,
				new Promise<string>((_, reject) => setTimeout(() => reject(TIMED_OUT_ERROR), 300_000)), // 5min timeout
				promiseFromEvent<void, string>(token.onCancellationRequested, (_, __, reject) => { reject(USER_CANCELLATION_ERROR); }).promise
			]);
		} finally {
			this._pendingNonces.delete(scopeKey);
			codeExchangePromise?.cancel.fire();
			this._codeExchangePromises.delete(scopeKey);
		}
	}

	private handleEvent: (logger: Log, scopes: string) => PromiseAdapter<vscode.Uri, string> =
		(logger: Log, scopes) => (uri, resolve, reject) => {
			const query = new URLSearchParams(uri.query);
			const code = query.get('code');
			const nonce = query.get('nonce');
			if (!code) {
				reject(new Error('No code'));
				return;
			}
			if (!nonce) {
				reject(new Error('No nonce'));
				return;
			}

			const acceptedNonces = this._pendingNonces.get(scopes) || [];
			if (!acceptedNonces.includes(nonce)) {
				// A common scenario of this happening is if you:
				// 1. Trigger a sign in with one set of scopes
				// 2. Before finishing 1, you trigger a sign in with a different set of scopes
				// In this scenario we should just return and wait for the next UriHandler event
				// to run as we are probably still waiting on the user to hit 'Continue'
				logger.info('Nonce not found in accepted nonces. Skipping this execution...');
				return;
			}

			resolve(code);
		};
}

function generateSessionId(): string {
	return crypto.getRandomValues(new Uint32Array(2)).reduce((prev, curr) => prev += curr.toString(16), '');
}

/** Holds authentication sessions and token flows for one GitHub instance. */
export class GitHubSessionEngine implements vscode.AuthenticationProvider, vscode.Disposable {
	private readonly _sessionChangeEmitter = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	private readonly _logger: Log;
	private readonly _githubServer: IGitHubServer;
	private readonly _telemetryReporter: ExperimentationTelemetry;
	private readonly _keychain: Keychain;
	private readonly _accountLabelSuffix: string | undefined;
	private readonly _accountsSeen = new Set<string>();
	private readonly _disposable: vscode.Disposable | undefined;

	/** The sessions backed by the Keychain, and therefore shared with other windows. */
	private _persistedSessionsPromise: Promise<vscode.AuthenticationSession[]>;

	constructor(
		private readonly context: vscode.ExtensionContext,
		uriHandler: UriEventHandler,
		ghesUri?: vscode.Uri,
		storageKey?: string
	) {
		this._telemetryReporter = new ExperimentationTelemetry(context, new NoopTelemetryReporter());

		const type = ghesUri ? AuthProviderType.githubEnterprise : AuthProviderType.github;
		this._accountLabelSuffix = ghesUri ? ` - ${ghesUri.authority}${ghesUri.path.replace(/\/+$/, '')}` : undefined;

		this._logger = new Log(type, ghesUri);

		const serviceId = storageKey ?? (type === AuthProviderType.github
			? `${type}.auth`
			: `${ghesUri?.authority}${ghesUri?.path}.ghes.auth`);

		this._keychain = new Keychain(this.context, serviceId, this._logger);

		this._githubServer = new GitHubServer(
			this._logger,
			this._telemetryReporter,
			uriHandler,
			context.extension.extensionKind,
			ghesUri);

		// Contains the current state of the sessions we have available.
		this._persistedSessionsPromise = this.readSessions().then((sessions) => {
			// fire telemetry after a second to allow the workbench to focus on loading
			setTimeout(() => sessions.forEach(s => this.afterSessionLoad(s)), 1000);
			return sessions;
		});

		this._disposable = vscode.Disposable.from(
			this._telemetryReporter,
			this._sessionChangeEmitter,
			this._logger,
			this.context.secrets.onDidChange(() => this.checkForUpdates())
		);
	}

	dispose() {
		this._disposable?.dispose();
	}

	get onDidChangeSessions() {
		return this._sessionChangeEmitter.event;
	}

	/** Returns locally held sessions without contacting GitHub. */
	async getCachedSessions(): Promise<readonly vscode.AuthenticationSession[]> {
		return await this._persistedSessionsPromise;
	}

	private accountName(label: string): string {
		const suffix = this._accountLabelSuffix;
		return suffix && label.endsWith(suffix) ? label.slice(0, -suffix.length) : label;
	}

	private accountLabel(name: string): string {
		return `${name}${this._accountLabelSuffix ?? ''}`;
	}

	async getSessions(scopes: string[] | undefined, options?: vscode.AuthenticationProviderSessionOptions): Promise<vscode.AuthenticationSession[]> {
		// For GitHub scope list, order doesn't matter so we immediately sort the scopes
		const sortedScopes = scopes?.sort() || [];
		const describedScopes = sortedScopes.length ? sortedScopes.join(',') : 'all scopes';
		this._logger.info(`Getting sessions for ${describedScopes}...`);

		const candidates = await this._persistedSessionsPromise;
		const matchesServer = (session: vscode.AuthenticationSession) => !options?.authorizationServer
			|| !!session.authorizationServer && getEnterpriseUriKey(session.authorizationServer) === getEnterpriseUriKey(options.authorizationServer);
		const wanted = candidates.filter(session =>
			matchesServer(session)
			&& (!options?.account || this.accountName(session.account.label) === this.accountName(options.account.label))
			&& (!sortedScopes.length || arrayEquals([...session.scopes].sort(), sortedScopes)));

		this._logger.info(`Got ${wanted.length} sessions for ${describedScopes}...`);
		return wanted;
	}

	private async afterSessionLoad(session: vscode.AuthenticationSession): Promise<void> {
		// We only want to fire a telemetry if we haven't seen this account yet in this session.
		if (!this._accountsSeen.has(session.account.id)) {
			this._accountsSeen.add(session.account.id);
			this._githubServer.sendAdditionalTelemetryInfo(session);
		}
	}

	private logSessionChange(source: 'secret-storage' | 'interactive-login', added: number, removed: number, changed: number): void {
		const kind = added > 0 && removed > 0 ? 'replacement' : added > 0 ? 'addition' : removed > 0 ? 'removal' : 'change';
		const message = `Session change: source=${source}, kind=${kind}, added=${added}, removed=${removed}, changed=${changed}.`;
		if (kind === 'replacement') {
			this._logger.info(message);
		} else {
			this._logger.trace(message);
		}
	}

	private async checkForUpdates() {
		const previousSessions = await this._persistedSessionsPromise;
		this._persistedSessionsPromise = this.readSessions();
		const storedSessions = await this._persistedSessionsPromise;

		const added: vscode.AuthenticationSession[] = [];
		const removed: vscode.AuthenticationSession[] = [];

		storedSessions.forEach(session => {
			const matchesExisting = previousSessions.some(s => s.id === session.id);
			// Another window added a session to the keychain, add it to our state as well
			if (!matchesExisting) {
				this._logger.info('Adding session found in keychain');
				added.push(session);
			}
		});

		previousSessions.forEach(session => {
			const matchesExisting = storedSessions.some(s => s.id === session.id);
			// Another window has logged out, remove from our state
			if (!matchesExisting) {
				this._logger.info('Removing session no longer found in keychain');
				removed.push(session);
			}
		});

		if (added.length || removed.length) {
			this.logSessionChange('secret-storage', added.length, removed.length, 0);
			this._sessionChangeEmitter.fire({ added, removed, changed: [] });
		}
	}

	private async readSessions(): Promise<vscode.AuthenticationSession[]> {
		let sessionData: SessionData[];
		try {
			this._logger.info('Reading sessions from keychain...');
			const storedSessions = await this._keychain.getToken();
			if (!storedSessions) {
				return [];
			}
			this._logger.info('Got stored sessions!');

			try {
				sessionData = JSON.parse(storedSessions);
			} catch (e) {
				await this._keychain.deleteToken();
				throw e;
			}
		} catch (e) {
			this._logger.error(`Error reading token: ${e}`);
			return [];
		}

		// Unfortunately, we were using a number secretly for the account id for some time... this is due to a bad `any`.
		// AuthenticationSession's account id is a string, so we need to detect when there is a number accountId and re-store
		// the sessions to migrate away from the bad number usage.
		// TODO@TylerLeonhardt: Remove this after we are confident that all users have migrated to the new id.
		let seenNumberAccountId: boolean = false;
		// TODO: eventually remove this Set because we should only have one session per set of scopes.
		const scopesSeen = new Set<string>();
		const sessionPromises = sessionData.map(async (session: SessionData): Promise<vscode.AuthenticationSession | undefined> => {
			// For GitHub scope list, order doesn't matter so we immediately sort the scopes
			const scopesStr = [...session.scopes].sort().join(' ');
			let userInfo: IGitHubUserInfo | undefined;
			if (!session.account) {
				try {
					userInfo = await this._githubServer.getUserInfo(session.accessToken);
					this._logger.info(`Verified session with the following scopes: ${scopesStr}`);
				} catch (e) {
					if (e.message === 'Unauthorized') {
						return undefined;
					}
				}
			}

			this._logger.trace(`Read the following session from the keychain with the following scopes: ${scopesStr}`);
			scopesSeen.add(scopesStr);

			let accountId: string;
			if (session.account?.id) {
				if (typeof session.account.id === 'number') {
					seenNumberAccountId = true;
				}
				accountId = `${session.account.id}`;
			} else {
				accountId = userInfo?.id ?? '<unknown>';
			}
			const icon = session.account?.icon
				? vscode.Uri.from(session.account.icon)
				: userInfo?.avatarUrl ? vscode.Uri.parse(userInfo.avatarUrl) : undefined;
			return {
				id: session.id,
				account: {
					label: this.accountLabel(session.account
						? session.account.label ?? session.account.displayName ?? '<unknown>'
						: (userInfo?.accountName ?? '<unknown>')),
					id: accountId,
					icon,
				},
				// we set this to session.scopes to maintain the original order of the scopes requested
				// by the extension that called getSession()
				scopes: session.scopes,
				accessToken: session.accessToken,
				authorizationServer: session.authorizationServer
					? vscode.Uri.from(session.authorizationServer)
					: vscode.Uri.joinPath(this._githubServer.getFallbackBaseUri(), '/login/oauth')
			};
		});

		const verifiedSessions = (await Promise.allSettled(sessionPromises))
			.filter(p => p.status === 'fulfilled')
			.map(p => (p as PromiseFulfilledResult<vscode.AuthenticationSession | undefined>).value)
			.filter(<T>(p?: T): p is T => Boolean(p));

		this._logger.info(`Got ${verifiedSessions.length} verified sessions.`);
		// Account data discovered during reads must not trigger a secret write because web embedders can re-expose accountless sessions.
		if (seenNumberAccountId || verifiedSessions.length !== sessionData.length) {
			await this.storeSessions(verifiedSessions);
		}

		return verifiedSessions;
	}

	private async storeSessions(sessions: vscode.AuthenticationSession[]): Promise<void> {
		this._logger.info(`Storing ${sessions.length} sessions...`);
		this._persistedSessionsPromise = Promise.resolve(sessions);
		await this._keychain.setToken(JSON.stringify(sessions.map(session => ({
			...session,
			account: { ...session.account, label: this.accountName(session.account.label) }
		}))));
		this._logger.info(`Stored ${sessions.length} sessions!`);
	}

	public async createSession(scopes: string[], options?: GitHubAuthenticationProviderOptions): Promise<vscode.AuthenticationSession> {
		try {
			// For GitHub scope list, order doesn't matter so we use a sorted scope to determine
			// if we've got a session already.
			const sortedScopes = [...scopes].sort();

			/* __GDPR__
				"login" : {
					"owner": "TylerLeonhardt",
					"comment": "Used to determine how much usage the GitHub Auth Provider gets.",
					"scopes": { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight", "comment": "Used to determine what scope combinations are being requested." }
				}
			*/
			this._telemetryReporter?.sendTelemetryEvent('login', {
				scopes: JSON.stringify(scopes),
			});

			if (options && !isGitHubAuthenticationProviderOptions(options)) {
				throw new Error('Invalid options');
			}
			const loginWith = options?.account && this.accountName(options.account.label);
			const signInProvider = options?.provider;
			this._logger.info(`Logging in with${signInProvider ? ` ${signInProvider}, ` : ''} '${loginWith ? loginWith : 'any'}' account...`);

			const sessions = await this._persistedSessionsPromise;
			const scopeString = sortedScopes.join(' ');
			const token = await this._githubServer.login(scopeString, signInProvider, options?.extraAuthorizeParameters, loginWith);
			const session = await this.tokenToSession(token, scopes, options?.authorizationServer);
			this.afterSessionLoad(session);

			const sessionIndex = sessions.findIndex(s => s.account.id === session.account.id && arrayEquals([...s.scopes].sort(), sortedScopes));
			const removed = new Array<vscode.AuthenticationSession>();
			if (sessionIndex > -1) {
				removed.push(...sessions.splice(sessionIndex, 1, session));
			} else {
				sessions.push(session);
			}
			await this.storeSessions(sessions);

			this.logSessionChange('interactive-login', 1, removed.length, 0);
			this._sessionChangeEmitter.fire({ added: [session], removed, changed: [] });

			this._logger.info('Login success!');

			return session;
		} catch (e) {
			// If login was cancelled, do not notify user.
			if (e === 'Cancelled' || e.message === 'Cancelled') {
				/* __GDPR__
					"loginCancelled" : { "owner": "TylerLeonhardt", "comment": "Used to determine how often users cancel the login flow." }
				*/
				this._telemetryReporter?.sendTelemetryEvent('loginCancelled');
				throw e;
			}

			/* __GDPR__
				"loginFailed" : { "owner": "TylerLeonhardt", "comment": "Used to determine how often users run into an error login flow." }
			*/
			this._telemetryReporter?.sendTelemetryEvent('loginFailed');

			vscode.window.showErrorMessage(vscode.l10n.t('Sign in failed: {0}', `${e}`));
			this._logger.error(e);
			throw e;
		}
	}

	/**
	 * A session for a GitHub identity that has already been resolved, so nothing here needs a
	 * lookup.
	 *
	 * `scopes` is what the session is findable by: `getSessions` compares this list to the one it
	 * was asked for, so anything other than the scopes the token actually carries leaves the session
	 * findable by the wrong lookup or by none.
	 */
	private sessionFor(account: IGitHubUserInfo, token: IGitHubToken, scopes: string[]): vscode.AuthenticationSession {
		return {
			id: generateSessionId(),
			accessToken: token.token,
			account: {
				label: this.accountLabel(account.accountName),
				id: account.id,
				icon: account.avatarUrl ? vscode.Uri.parse(account.avatarUrl) : undefined
			},
			scopes,
			authorizationServer: token.authorizationServer
		};
	}

	private checkAuthorizationServer(token: IGitHubToken, authorizationServer: vscode.Uri | undefined): void {
		if (authorizationServer && getEnterpriseUriKey(token.authorizationServer) !== getEnterpriseUriKey(authorizationServer)) {
			throw new Error(vscode.l10n.t('The GitHub session does not belong to the requested authorization server.'));
		}
	}

	private async tokenToSession(token: IGitHubToken, scopes: string[], authorizationServer?: vscode.Uri): Promise<vscode.AuthenticationSession> {
		this.checkAuthorizationServer(token, authorizationServer);
		const userInfo = await this._githubServer.getUserInfo(token.token);
		return this.sessionFor(userInfo, token, scopes);
	}

	public async removeSession(id: string) {
		try {
			/* __GDPR__
				"logout" : { "owner": "TylerLeonhardt", "comment": "Used to determine how often users log out of an account." }
			*/
			this._telemetryReporter?.sendTelemetryEvent('logout');

			this._logger.info(`Logging out of ${id}`);

			const sessions = await this._persistedSessionsPromise;
			const sessionIndex = sessions.findIndex(session => session.id === id);
			if (sessionIndex > -1) {
				const session = sessions[sessionIndex];
				sessions.splice(sessionIndex, 1);

				await this.storeSessions(sessions);
				await this._githubServer.logout(session);

				this._sessionChangeEmitter.fire({ added: [], removed: [session], changed: [] });
			} else {
				this._logger.error('Session not found');
			}
		} catch (e) {
			/* __GDPR__
				"logoutFailed" : { "owner": "TylerLeonhardt", "comment": "Used to determine how often logging out of an account fails." }
			*/
			this._telemetryReporter?.sendTelemetryEvent('logoutFailed');

			vscode.window.showErrorMessage(vscode.l10n.t('Sign out failed: {0}', `${e}`));
			this._logger.error(e);
			throw e;
		}
	}
}
