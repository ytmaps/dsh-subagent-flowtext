# dsh-subagent-flowtext

[中文](README.zh.md)

`dsh-subagent-flowtext` registers one DeepSeek Harness route: `flowtext-direct / flowtext-agent`. DSH receives the user instruction, renders a sanitized compact execution trace, and records the terminal answer. FlowText exclusively owns classification, planning, discovery, reads, writes, tools, clarification, approval, and finalization.

The plugin does not register a `SubagentProvider`, expose `subagent_flowtext`, or install `tool-subagent-flowtext`.

## Requirements

- Node.js `^22.19.0` or `>=24`
- DeepSeek Harness
- Obsidian desktop with FlowText Agent Gateway enabled

## Install

```sh
dsh plugin --profile web add github:ytmaps/dsh-subagent-flowtext
```

The bundled `cordis.patch.yml` creates only one Cordis entry:

```yaml
- id: flowtext-direct
  name: dsh-subagent-flowtext
```

No environment variable, token copy, or manual Profile edit is needed. The first task asks for local authorization in FlowText; one approval stores and automatically reuses a local DSH credential.

If upgrading from `0.4.x` or earlier, remove the old package before adding it again so obsolete `subagent-flowtext` and `tool-subagent-flowtext` entries are cleared.

## Runtime behavior

- Every DSH Agent request is forced through `flowtext-direct / flowtext-agent`.
- By default, safe phase, plan, and tool summaries stream into DSH as reasoning content; they never become DSH tool calls.
- Set `progressMode: off` to retain final-answer-only behavior.
- Only the latest real user message and DSH `sessionId` are sent.
- DSH system prompts, tool catalogs, assistant history, and plugin context are not forwarded.
- The same DSH `sessionId` reuses one persistent FlowText conversation and Agent panel.
- Different DSH sessions receive independent FlowText Agent panels.
- The complete trajectory is shown in FlowText; DSH receives only the final answer.
- Clarification and dangerous-operation approval pause DSH until handled in FlowText UI.
- DSH model retries are disabled to prevent duplicate write tasks.

## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `baseUrl` | `http://127.0.0.1:27124/flowtext-agent/v1` | Loopback-only FlowText Gateway URL. |
| `autoPair` | `true` | Ask FlowText for local authorization when no credential exists. |
| `credentialPath` | DSH credential directory | Optional credential-file override. |
| `clientName` | `DeepSeek Harness` | Name shown in the FlowText pairing prompt. |
| `clientId` | `deepseek-harness` | Stable client identity. |
| `modelId` | unset | Optional FlowText model. |
| `activePath` | unset | Optional vault-relative active note. |
| `contextPaths` | `[]` | Optional vault-relative context paths. |
| `policy` | `{}` | Requested authority; FlowText foreground policy remains authoritative. |
| `runOptions` | `{}` | FlowText options such as `thinkingEnabled`. |
| `requestTimeoutMs` | `30000` | Ordinary HTTP timeout. |
| `longPollMs` | `25000` | Gateway event long-poll duration. |
| `maxResponseBytes` | `2097152` | Gateway response limit. |
| `maxPromptBytes` | `1048576` | User-instruction limit. |
| `maxAnswerBytes` | `1048576` | Terminal-answer limit. |

## Security

The Gateway accepts loopback endpoints only. Automatic pairing rejects browser origins and requires explicit authorization in Obsidian. Credentials never enter the Profile, repository, shell history, or model context. Cancelling the parent request or disposing the DSH run cancels the matching FlowText task.

Only text instructions and text terminal answers are currently supported; images and structured output are not forwarded from DSH.
