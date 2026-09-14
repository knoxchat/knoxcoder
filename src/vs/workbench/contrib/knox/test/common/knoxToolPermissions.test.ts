/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	KNOX_DEFAULT_TOOL_SETTING,
	knoxApplyPresetToExistingSettings,
	knoxBuiltInAutoApproveToolSettings,
	knoxBuiltInSafeToolSettings,
	knoxCategorizedToolName,
	knoxCycleToolSetting,
	knoxDefaultSettingForTool,
	knoxDuplicateToolNames,
	knoxFormatPolicyLines,
	knoxGetToolPermissionDisplay,
	knoxIsCurrentToolAutoApproved,
	knoxIsSamePermissionTool,
	knoxIsToolAutoApproved,
	knoxParseAgentPolicy,
	knoxParsePolicyLines,
	knoxParseStoredToolGroupSettings,
	knoxParseStoredToolSettings,
	knoxParseTools,
	knoxPolicyEditorState,
	knoxSafeSettingForTool,
	knoxShouldShowPermissionButtons,
	knoxToggleToolGroupSetting,
	knoxToolsByGroup,
} from '../../common/knoxToolPermissions.js';
import { KnoxBuiltInToolName } from '../../common/knoxToolNames.js';
import type { IKnoxToolCallState } from '../../common/knoxChatTypes.js';

suite('knox tool permissions (T5.7)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('auto-approves every catalog tool by default; Safe asks on writes', () => {
		assert.strictEqual(KNOX_DEFAULT_TOOL_SETTING, 'allowedWithoutPermission');
		assert.strictEqual(knoxDefaultSettingForTool(KnoxBuiltInToolName.EditFile), 'allowedWithoutPermission');
		assert.strictEqual(knoxSafeSettingForTool(KnoxBuiltInToolName.ReadFile, true), 'allowedWithoutPermission');
		assert.strictEqual(knoxSafeSettingForTool(KnoxBuiltInToolName.EditFile), 'allowedWithPermission');
		assert.strictEqual(knoxSafeSettingForTool(KnoxBuiltInToolName.RunTerminalCommand), 'allowedWithPermission');
		assert.strictEqual(knoxSafeSettingForTool(KnoxBuiltInToolName.Plan), 'allowedWithoutPermission');
		assert.strictEqual(knoxBuiltInSafeToolSettings()[KnoxBuiltInToolName.WriteFile], 'allowedWithPermission');
		assert.strictEqual(knoxBuiltInAutoApproveToolSettings()[KnoxBuiltInToolName.EditFile], 'allowedWithoutPermission');
	});

	test('YOLO / Safe presets keep unknown tools and cycle per-tool settings', () => {
		const tools = [
			{ function: { name: KnoxBuiltInToolName.EditFile }, readonly: false },
			{ function: { name: KnoxBuiltInToolName.ReadFile }, readonly: true },
		];
		const yolo = knoxApplyPresetToExistingSettings({ custom_http: 'disabled' }, tools, 'yolo');
		assert.strictEqual(yolo[KnoxBuiltInToolName.EditFile], 'allowedWithoutPermission');
		assert.strictEqual(yolo.custom_http, 'allowedWithoutPermission');
		const safe = knoxApplyPresetToExistingSettings({ custom_http: 'disabled' }, tools, 'safe');
		assert.strictEqual(safe[KnoxBuiltInToolName.EditFile], 'allowedWithPermission');
		assert.strictEqual(safe.custom_http, 'disabled');
		assert.strictEqual(knoxCycleToolSetting('allowedWithPermission'), 'allowedWithoutPermission');
		assert.strictEqual(knoxCycleToolSetting('allowedWithoutPermission'), 'disabled');
		assert.strictEqual(knoxCycleToolSetting('disabled'), 'allowedWithPermission');
		assert.strictEqual(knoxToggleToolGroupSetting('include'), 'exclude');
		assert.strictEqual(knoxToggleToolGroupSetting(undefined), 'exclude');
	});

	test('permission badges prefer session Always over ask-first', () => {
		assert.strictEqual(knoxGetToolPermissionDisplay({
			toolName: KnoxBuiltInToolName.CreateNewFile,
			toolSettings: { [KnoxBuiltInToolName.CreateNewFile]: 'disabled' },
		}), 'disabled');
		assert.strictEqual(knoxGetToolPermissionDisplay({
			toolName: KnoxBuiltInToolName.CreateNewFile,
			toolSettings: { [KnoxBuiltInToolName.CreateNewFile]: 'allowedWithoutPermission' },
		}), 'autoApprove');
		assert.strictEqual(knoxGetToolPermissionDisplay({
			toolName: KnoxBuiltInToolName.CreateNewFile,
			toolSettings: { [KnoxBuiltInToolName.CreateNewFile]: 'allowedWithPermission' },
			sessionAllowlist: [KnoxBuiltInToolName.CreateNewFile],
		}), 'sessionAlways');
		assert.strictEqual(knoxGetToolPermissionDisplay({
			toolName: KnoxBuiltInToolName.CreateNewFile,
			toolSettings: { [KnoxBuiltInToolName.CreateNewFile]: 'allowedWithPermission' },
		}), 'requiresApproval');
		assert.strictEqual(knoxIsSamePermissionTool('create_new_file', KnoxBuiltInToolName.CreateNewFile), true);
	});

	test('groups tools, flags duplicate names, and formats catalog labels', () => {
		const tools = knoxParseTools([
			{ function: { name: 'builtin_read_file' }, displayTitle: 'Read File', group: 'Built-in' },
			{ function: { name: 'builtin_read_file' }, group: 'Built-in' },
			{ function: { name: 'builtin_search_web' }, group: 'Web' },
			{ notATool: true },
		]);
		assert.strictEqual(tools.length, 3);
		const groups = knoxToolsByGroup(tools);
		assert.deepStrictEqual(groups.map(([name, list]) => [name, list.length]), [['Built-in', 2], ['Web', 1]]);
		assert.strictEqual(knoxDuplicateToolNames(tools).builtin_read_file, true);
		assert.strictEqual(knoxDuplicateToolNames(tools).builtin_search_web, false);
		assert.strictEqual(knoxCategorizedToolName(tools[0]), '[Files] Read File');
		assert.strictEqual(knoxCategorizedToolName('builtin_run_terminal_command'), '[Terminal] Run Terminal Command');
	});

	test('formats and parses path/command policy lines', () => {
		const text = knoxFormatPolicyLines([
			{ action: 'deny', pattern: '~/.ssh/**' },
			{ action: 'ask', pattern: 'git *' },
		]);
		assert.strictEqual(text, 'deny ~/.ssh/**\nask git *');
		assert.deepStrictEqual(knoxParsePolicyLines('deny ~/.ssh/**\n# comment\nask git *\nnot-a-rule'), [
			{ action: 'deny', pattern: '~/.ssh/**' },
			{ action: 'ask', pattern: 'git *' },
		]);
		const policy = knoxParseAgentPolicy({
			paths: [{ pattern: '~/.aws/**', action: 'deny' }],
			externalDirectory: 'allow',
			sandboxDestructive: false,
		});
		assert.strictEqual(policy?.externalDirectory, 'allow');
		assert.strictEqual(policy?.sandboxDestructive, false);
		const editor = knoxPolicyEditorState(undefined);
		assert.ok(editor.paths.includes('deny ~/.ssh/**'));
		assert.strictEqual(editor.externalDirectory, 'ask');
		assert.strictEqual(editor.sandboxDestructive, true);
	});

	test('hydrates stored settings and auto-approves from mode + allowlist', () => {
		assert.strictEqual(knoxParseStoredToolSettings(undefined)[KnoxBuiltInToolName.EditFile], 'allowedWithoutPermission');
		assert.strictEqual(knoxParseStoredToolSettings('{"builtin_edit_file":"disabled"}')[KnoxBuiltInToolName.EditFile], 'disabled');
		assert.deepStrictEqual(knoxParseStoredToolGroupSettings('{"Built-in":"exclude"}'), { 'Built-in': 'exclude' });
		assert.strictEqual(knoxIsToolAutoApproved({
			toolName: KnoxBuiltInToolName.EditFile,
			toolSettings: { [KnoxBuiltInToolName.EditFile]: 'disabled' },
			permissionMode: 'fullAuto',
		}), false);
		assert.strictEqual(knoxIsToolAutoApproved({
			toolName: KnoxBuiltInToolName.EditFile,
			toolSettings: { [KnoxBuiltInToolName.EditFile]: 'allowedWithPermission' },
			permissionMode: 'acceptEdits',
		}), true);
		assert.strictEqual(knoxIsToolAutoApproved({
			toolName: KnoxBuiltInToolName.RunTerminalCommand,
			toolSettings: { [KnoxBuiltInToolName.RunTerminalCommand]: 'allowedWithPermission' },
			permissionMode: 'acceptEdits',
		}), false);
		assert.strictEqual(knoxIsToolAutoApproved({
			toolName: KnoxBuiltInToolName.RunTerminalCommand,
			toolSettings: { [KnoxBuiltInToolName.RunTerminalCommand]: 'allowedWithPermission' },
			permissionMode: 'default',
			sessionAllowlist: [KnoxBuiltInToolName.RunTerminalCommand],
		}), true);
	});

	test('hides Deny/Always/Approve when the pending tool is auto-approved', () => {
		const pending = (name: string, status: IKnoxToolCallState['status'] = 'generated'): IKnoxToolCallState => ({
			toolCallId: 'tc-1',
			status,
			parsedArgs: {},
			toolCall: { id: 'tc-1', type: 'function', function: { name, arguments: '{}' } },
		});
		const askFirst = { [KnoxBuiltInToolName.CreateNewFile]: 'allowedWithPermission' as const };
		assert.strictEqual(knoxIsCurrentToolAutoApproved({
			toolCall: pending(KnoxBuiltInToolName.CreateNewFile),
			toolSettings: { [KnoxBuiltInToolName.CreateNewFile]: 'allowedWithoutPermission' },
			permissionMode: 'default',
		}), true);
		assert.strictEqual(knoxShouldShowPermissionButtons({
			pending: pending(KnoxBuiltInToolName.CreateNewFile),
			toolSettings: { [KnoxBuiltInToolName.CreateNewFile]: 'allowedWithoutPermission' },
			permissionMode: 'default',
		}), false);
		assert.strictEqual(knoxShouldShowPermissionButtons({
			pending: pending(KnoxBuiltInToolName.CreateNewFile),
			toolSettings: askFirst,
			permissionMode: 'default',
		}), true);
		assert.strictEqual(knoxShouldShowPermissionButtons({
			pending: pending(KnoxBuiltInToolName.CreateNewFile),
			toolSettings: askFirst,
			permissionMode: 'default',
			sessionAllowlist: [KnoxBuiltInToolName.CreateNewFile],
		}), false);
		assert.strictEqual(knoxShouldShowPermissionButtons({
			pending: pending(KnoxBuiltInToolName.CreateNewFile),
			targetName: KnoxBuiltInToolName.EditFile,
			toolSettings: askFirst,
			permissionMode: 'default',
		}), false);
		assert.strictEqual(knoxShouldShowPermissionButtons({
			pending: pending(KnoxBuiltInToolName.AskUser),
			toolSettings: { [KnoxBuiltInToolName.AskUser]: 'allowedWithPermission' },
			permissionMode: 'default',
		}), false);
	});
});
