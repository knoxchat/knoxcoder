/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable */

export const knoxGuiStringsEnErrors: Record<string, unknown> = {
	"oopsSomethingWentWrong": "Oops! Something went wrong",
	"errorExclamation": "Error!",
	"failedToLoadConfiguration": "Failed to load configuration",
	"learnMore": "Learn more",
	"configErrors": "Config Errors",
	"pleaseResolveConfigErrors": "Please resolve the following errors in your assistant configuration.",
	"fatalError": "Fatal Error:",
	"warning": "Warning:",
	"noConfigErrorsFound": "No configuration errors found.",
	"error": "Error",
	"rateLimited": "This might mean your {{model}} usage has been rate limited by {{provider}}.",
	"likelyCauses": "Likely causes:",
	"invalidApiBase": "Invalid",
	"modelNotFound": "Model/deployment not found",
	"refreshHubSecrets": "If your hub secret values may have changed, refresh your assistants",
	"refreshAssistantSecrets": "Refresh assistant secrets",
	"invalidApiKey": "It's possible that your API key is invalid.",
	"serverOverloaded": "Most likely, the provider's server(s) are overloaded and streaming was interrupted. Try again later",
	"provider": "Provider",
	"errorRetry": "Retry",
	"errorSwitchModel": "Switch model",
	"firstRunNoModel": "No model is configured yet. Sign in with KnoxStudio, or add a bring-your-own API key, then pick a model.",
	"errorOpenSettings": "Open settings",
	"errorRateLimitHint": "The provider is rate limiting requests. Wait a moment and retry, or switch to another model in settings.",
	"errorRateLimitHintKnoxChat": "KnoxStudio is rate limiting this key. Wait and retry, or switch model in settings.",
	"errorRateLimitHintOpenAI": "OpenAI returned HTTP 429. Check usage limits at platform.openai.com, wait, or switch model.",
	"errorRateLimitHintAnthropic": "Anthropic returned HTTP 429. Check plan limits at console.anthropic.com, wait, or switch model.",
	"errorRateLimitHintOpenRouter": "OpenRouter is rate limiting this key. Wait, add credits, or switch model.",
	"errorQuotaHint": "This account is out of quota (HTTP 402). Check billing with the provider, or switch model.",
	"errorQuotaHintKnoxChat": "KnoxStudio quota is exhausted (HTTP 402). Add billing or switch to a bring-your-own key.",
	"errorQuotaHintOpenAI": "OpenAI quota or billing failed (HTTP 402). Check billing at platform.openai.com.",
	"errorQuotaHintAnthropic": "Anthropic credit or quota failed (HTTP 402). Check console.anthropic.com billing.",
	"errorQuotaHintOpenRouter": "OpenRouter credits are exhausted (HTTP 402). Add credits or switch model.",
	"errorSessionCost": "Session so far: {{cost}} ({{tokens}} tokens)",
	"errorCopyDiagnostic": "Copy diagnostic"
};
