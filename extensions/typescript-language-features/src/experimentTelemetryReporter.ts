/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as tas from 'vscode-tas-client';

export interface IExperimentationTelemetryReporter extends tas.IExperimentationTelemetry, vscode.Disposable {
	postEventObj(eventName: string, props: { [prop: string]: string }): void;
}

export class ExperimentationTelemetryReporter implements IExperimentationTelemetryReporter {

	private _sharedProperties: Record<string, string> = {};

	constructor() { }

	setSharedProperty(name: string, value: string): void {
		this._sharedProperties[name] = value;
	}

	postEvent(_eventName: string, _props: Map<string, string>): void { }

	postEventObj(_eventName: string, _props: { [prop: string]: string }): void { }

	dispose(): void { }
}
