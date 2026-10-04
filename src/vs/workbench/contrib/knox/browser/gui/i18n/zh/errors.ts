/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable */

export const knoxGuiStringsZhErrors: Record<string, unknown> = {
	"oopsSomethingWentWrong": "哎呀！出了点问题",
	"errorExclamation": "错误！",
	"failedToLoadConfiguration": "加载配置失败",
	"learnMore": "了解更多",
	"configErrors": "配置错误",
	"pleaseResolveConfigErrors": "请解决助手配置中的以下错误。",
	"fatalError": "致命错误：",
	"warning": "警告：",
	"noConfigErrorsFound": "未发现配置错误。",
	"error": "错误",
	"rateLimited": "这可能意味着您的 {{model}} 使用量已被 {{provider}} 限制。",
	"likelyCauses": "可能的原因：",
	"invalidApiBase": "无效的",
	"modelNotFound": "未找到模型/部署",
	"refreshHubSecrets": "如果您的中心密钥值可能已更改，请刷新您的助手",
	"refreshAssistantSecrets": "刷新助手密钥",
	"invalidApiKey": "您的 API 密钥可能无效。",
	"serverOverloaded": "最有可能的情况是，提供商的服务器过载，流式传输被中断。请稍后重试",
	"provider": "提供商",
	"errorRetry": "重试",
	"errorSwitchModel": "切换模型",
	"firstRunNoModel": "尚未配置模型。请使用 KnoxStudio 登录，或添加自备 API 密钥，然后选择模型。",
	"errorOpenSettings": "打开设置",
	"errorRateLimitHint": "提供商正在限制请求频率。请稍等片刻后重试，或在设置中切换到其他模型。",
	"errorRateLimitHintKnoxChat": "KnoxStudio 正在限制此密钥的请求频率。请稍后再试，或在设置中切换模型。",
	"errorRateLimitHintOpenAI": "OpenAI 返回 HTTP 429。请在 platform.openai.com 检查用量限额，稍后再试，或切换模型。",
	"errorRateLimitHintAnthropic": "Anthropic 返回 HTTP 429。请在 console.anthropic.com 检查套餐限额，稍后再试，或切换模型。",
	"errorRateLimitHintOpenRouter": "OpenRouter 正在限制此密钥。请稍后再试、充值，或切换模型。",
	"errorQuotaHint": "此账号额度不足（HTTP 402）。请检查提供商账单，或切换模型。",
	"errorQuotaHintKnoxChat": "KnoxStudio 额度已用尽（HTTP 402）。请充值，或改用自备密钥。",
	"errorQuotaHintOpenAI": "OpenAI 额度或账单失败（HTTP 402）。请在 platform.openai.com 检查账单。",
	"errorQuotaHintAnthropic": "Anthropic 额度或账单失败（HTTP 402）。请在 console.anthropic.com 检查账单。",
	"errorQuotaHintOpenRouter": "OpenRouter 余额不足（HTTP 402）。请充值或切换模型。",
	"errorSessionCost": "本会话至今：{{cost}}（{{tokens}} tokens）",
	"errorCopyDiagnostic": "复制诊断信息"
};
