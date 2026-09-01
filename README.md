# dsh-subagent-flowtext

[中文](README.zh.md)

`dsh-subagent-flowtext` registers a remote, one-shot DeepSeek Harness `SubagentProvider` backed by the FlowText Agent Gateway in Obsidian. A delegation creates one FlowText task, follows its event stream until terminal settlement, and returns only the final FlowText answer through the shared Harness subagent result API.

## Requirements

- Node.js `^22.19.0` or `>=24`
- DeepSeek Harness with `@deepseek-ai/dsh-subagent`
- Obsidian desktop with FlowText Agent Gateway enabled

## Install

Install the package into the Harness Profile that should own the provider:

```sh
dsh plugin --profile web add dsh-subagent-flowtext
```

Before the npm registry release, install directly from the public GitHub
repository:

```sh
dsh plugin --profile web add github:ytmaps/dsh-subagent-flowtext
```

The repository includes reviewed, precompiled `dist` entry points, so a
GitHub-source or marketplace installation does not execute a dependency build
script and needs no pnpm `allowBuilds` grant. Pin a commit when a deployment
must not follow later changes to `main`.

The bundle enables both the Provider and the model-facing `subagent_flowtext` tool. No environment variable, token copy, or Profile edit is required. On the first invocation after restarting Harness, FlowText shows an “Allow DeepSeek Harness to connect?” confirmation. One approval stores the credential in a local mode-0600 file under the DSH credentials directory. Later starts reuse it automatically; rotating the FlowText Gateway token causes the next invocation to pair again.

Remove any hand-written `subagent-flowtext` or `tool-subagent-flowtext` Profile override rows left by an older release so they do not shadow the bundle defaults.

Repository maintainers should follow [PUBLISHING.md](PUBLISHING.md) for the
first npm publication and subsequent tokenless GitHub Actions releases.

## Marketplace discovery

DeepSeek Harness currently uses the GitHub `dsh-plugin` topic as its official
community-discovery convention; its built-in Plugins settings page is an
inventory of already installed Loader entries, not an official download
marketplace. Independent community marketplaces can index this repository and
install it directly from GitHub with the source command above. A marketplace
listing is not a DeepSeek security endorsement; review this package and its
requested FlowText policy before installation.

## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `providerName` | `flowtext` | Name registered in the Harness provider registry. |
| `baseUrl` | `http://127.0.0.1:27124/flowtext-agent/v1` | FlowText v1 endpoint. Non-loopback or HTTPS endpoints are rejected before the token can be sent. |
| `autoPair` | `true` | Ask FlowText for interactive local authorization when no stored credential exists. |
| `credentialPath` | `$DSH_HOME/credentials/dsh-subagent-flowtext.json` | Optional credential-file override; the default file uses mode 0600. |
| `clientName` | `DeepSeek Harness` | Client name shown in the FlowText pairing prompt. |
| `token` | unset | Legacy explicit Bearer token; normal users do not configure it. |
| `clientId` | `deepseek-harness` | Stable owner used by FlowText task recovery. |
| `modelId` | unset | Optional model configured in FlowText for every run. |
| `activePath` | unset | Optional vault-relative active note. No parent cwd is converted into an Obsidian path. |
| `contextPaths` | `[]` | Vault-relative task context paths. |
| `policy` | `{}` | Per-run authority request. FlowText server settings can only narrow it. |
| `runOptions` | `{}` | FlowText options such as `thinkingEnabled`. |
| `approvalDecision` | `deny` | Unattended answer to FlowText approvals: `deny`, `once`, or `session`. |
| `requestTimeoutMs` | `30000` | Normal request timeout. |
| `longPollMs` | `25000` | Event long-poll duration, at most 30 seconds. |
| `maxResponseBytes` | `2097152` | Maximum complete Gateway response. |
| `maxPromptBytes` | `1048576` | Maximum UTF-8 child prompt. |
| `maxAnswerBytes` | `1048576` | Maximum UTF-8 result returned to the parent. |

`policy` is sent as task data, not as authority minted by the model. The Provider instance fixes it in deployment configuration; FlowText intersects it with its own settings and enforces the result at tool exposure and action execution.

## Lifecycle and failure behavior

`start()` publishes only after FlowText accepts an idempotent task identified by `clientId + requestId`. The run long-polls incremental events and reads authoritative task snapshots. Parent cancellation and `dispose()` both request remote cancellation and wait for local result settlement; disposal is idempotent.

FlowText clarification requests cannot be represented by the one-shot `SubagentProvider` API, so the Provider cancels that task and returns `stopReason: error`. Approval requests are resolved with the configured unattended decision, which defaults to `deny`. Network, protocol, timeout, restart, and oversized-answer failures return bounded diagnostics without tokens, request bodies, file contents, or raw server payloads.

Automatic pairing accepts loopback clients only, rejects browser-originated requests, and requires an explicit approval in Obsidian. Credentials never enter the Profile, repository, shell history, or model context.

The Provider advertises no output-schema, depth-limit, tool-filter, persona, or parent-context inheritance capabilities. It intentionally does not implement `prepareContinuable`; FlowText owns the remote task and Harness owns the one-shot run.

## Model Experience

### Child request

#### What the model sees

FlowText receives the delegated text blocks as one standalone task plus the deployment-fixed model, context, run options, and policy. It does not receive the parent Harness transcript or parent filesystem cwd.

#### Token effect

The FlowText model pays for an independent Agent loop. Child tokens do not enter the parent context.

#### KV Cache effect

Independent of the parent request cache. Reuse is controlled by FlowText's model adapter, instructions, tools, and retained task context.

### Parent result

#### What the model sees

A foreground delegation returns only the final FlowText answer. A non-completed task returns the shared subagent error with a bounded safe diagnostic. FlowText plans, actions, observations, task ids, events, logs, tokens, and Gateway payloads are not copied into the parent Session.

#### Token effect

Only the retained final answer or error grows the parent context. Background execution additionally uses the normal Harness Job acknowledgement and collection messages.

#### KV Cache effect

Append-only: the result is appended after the reusable parent prefix and does not rewrite prior messages.

## Known Limitations and Deferred Work

- One fresh FlowText task per run; no remote conversation continuation or `prepareContinuable` support.
- Text prompts and final text answers only; image and structured-output delegation are rejected.
- Clarifications fail closed because the one-shot provider interface has no user-question channel.
- Intermediate FlowText progress is consumed for wakeups but is not projected into the parent transcript or UI.
- `approvalDecision: once|session` is unattended authority and must be selected explicitly; `deny` is the default.
- CLI authority remains a high-risk FlowText deployment choice and may exceed fine-grained vault path restrictions.
