#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Documented sqlite3 rebuild for Electron's Node ABI (T5.3).
 *
 * Usage (from repo root or this folder):
 *   node extensions/knox/scripts/rebuild-native.mts
 *
 * compile-extension:knox / compile-native-extensions-build also run this via
 * esbuild.mts after the host bundle. Do not vendor kc/binary sqlite archives.
 */
import * as path from 'node:path';
import { copyKnoxNativeAssets, knoxExtDir } from './native-assets.mts';

const outDir = path.join(knoxExtDir, 'dist');
copyKnoxNativeAssets(outDir, { rebuildSqlite: true });
