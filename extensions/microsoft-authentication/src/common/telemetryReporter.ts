/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthError } from '@azure/msal-node';
import { IExperimentationTelemetry } from 'vscode-tas-client';

export const enum MicrosoftAccountType {
	AAD = 'aad',
	MSA = 'msa',
	Unknown = 'unknown'
}

class NoopTelemetryReporter {
	sendTelemetryEvent(): void { }
	sendTelemetryErrorEvent(): void { }
	dispose(): void { }
}

export class MicrosoftAuthenticationTelemetryReporter implements IExperimentationTelemetry {
	private sharedProperties: Record<string, string> = {};
	protected _telemetryReporter = new NoopTelemetryReporter();

	constructor(_aiKey: string) { }

	get telemetryReporter(): NoopTelemetryReporter {
		return this._telemetryReporter;
	}

	setSharedProperty(name: string, value: string): void {
		this.sharedProperties[name] = value;
	}

	postEvent(_eventName: string, _props: Map<string, string>): void { }

	sendActivatedWithMsalNoBrokerEvent(): void { }

	sendLoginEvent(_scopes: readonly string[]): void { }

	sendLoginFailedEvent(): void { }

	sendLogoutEvent(): void { }

	sendLogoutFailedEvent(): void { }

	sendTelemetryErrorEvent(_error: Error | string): void { }

	sendTelemetryClientAuthErrorEvent(_error: AuthError): void { }

	sendAccountEvent(_scopes: string[], _accountType: MicrosoftAccountType): void { }

	protected _scrubGuids(scopes: readonly string[]): string[] {
		return scopes.map(s => s.replace(/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i, '{guid}'));
	}
}

export class MicrosoftSovereignCloudAuthenticationTelemetryReporter extends MicrosoftAuthenticationTelemetryReporter {
	override sendLoginEvent(_scopes: string[]): void { }

	override sendLoginFailedEvent(): void { }

	override sendLogoutEvent(): void { }
}
