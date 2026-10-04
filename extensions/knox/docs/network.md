# Network calls Knox makes

KnoxCoder does not send crash reports or usage telemetry to Microsoft.
VS Code telemetry remains off in this product (`enable-crash-reporter` is
forced false; Knox does not add anonymous stats).

| Destination | When | What is sent | Off switch |
|---|---|---|---|
| Your configured model provider (KnoxChat, OpenRouter, OpenAI-compatible, Anthropic, custom/Ollama) | Chat and agent turns | Prompts, tool results, images you attach | Do not configure a model / go offline |
| Jev (`https://api.knoxstudio.ai/v1/systemone`) | `knoxchat.jev.enabled` (default on) | User message, short turn summaries, tool name/arg previews, truncated assistant text. Never file contents. | `knoxchat.jev.enabled: false` |
| `builtin_fetch_url` | Agent calls the tool | HTTP GET of a public URL | `knoxchat.networkMode: deny` |
| GitHub Releases | Auto-update check | Version query (`updateUrl` in `product.json`) | Disable updates in the editor |
| Open VSX | Extension gallery | Marketplace queries | Do not open the Extensions view / empty gallery |
| KnoxChat OAuth | `knox login` | Auth code + PKCE | Do not sign in; use `KNOX_API_KEY` or a local model |

**Master switch for tools:** `knoxchat.networkMode`

- `allow` (default) — fetch_url uses the existing public-host guard (private IPs blocked unless `KNOX_FETCH_URL_ALLOW_PRIVATE=1`).
- `deny` — fetch_url is blocked; Auto-mode shell sandbox is taken off the network when a backend is available.
- `allowlist` — fetch_url only to `knoxchat.networkAllowlist` (or `KNOX_NETWORK_ALLOWLIST`). Shell sandbox still has no network.

Env overrides: `KNOX_NETWORK_MODE`, `KNOX_NETWORK_ALLOWLIST`.

There is no single “no network except my model” process-wide firewall. Model HTTP still uses your provider. Combine `networkMode: deny`, `jev.enabled: false`, a local model, and disabled auto-update for an offline-ish setup.
