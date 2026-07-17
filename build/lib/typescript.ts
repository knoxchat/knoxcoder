/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TypeScript 7 npm package only exposes version info on the main entry.
 * Build tooling still needs the classic programmatic compiler/language-service API.
 */
import ts from '@typescript/typescript6';

export default ts;
export * from '@typescript/typescript6';
