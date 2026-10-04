# Command sandbox (P1-2)

Setting: `knoxchat.sandbox` = `off` | `workspace-write` | `read-only` (default `off`).
Env: `KNOX_SANDBOX`. Fail closed if the backend is missing: `KNOX_SANDBOX_REQUIRED=1`.

| Mode | Writes | Network (when `knoxchat.networkMode` is deny/allowlist) |
|---|---|---|
| `off` | unrestricted (still under commandGuard + path policy) | unrestricted |
| `workspace-write` | workspace + temp dirs | denied in the sandbox |
| `read-only` | temp dirs only | denied in the sandbox |

## Backends

- **macOS:** `sandbox-exec` with an allow-default seatbelt profile that then `deny file-write*` except the workspace (workspace-write) and temp paths.
- **Linux:** `bwrap --ro-bind / /` then `--bind` workspace and temp; `--unshare-net` when network is denied.
- **Windows:** no OS wrapper. The composer chip and `knox doctor` report the limitation. Path policy and commandGuard still apply.

If the binary is missing, Knox runs the command unsandboxed and prepends a warning to the tool result unless `KNOX_SANDBOX_REQUIRED=1`.

The sandbox is a second line after `commandGuard`. It does not replace Workspace Trust or the permission prompt.
