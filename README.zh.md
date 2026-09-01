# dsh-subagent-flowtext

[English](README.md)

`dsh-subagent-flowtext` 为 DeepSeek Harness 注册一个由 Obsidian FlowText Agent Gateway 驱动的远程、一次性 `SubagentProvider`。每次委派创建一个 FlowText 任务，持续读取增量事件直到任务结束，然后通过 Harness 的统一子 Agent 结果接口返回最终答案。

## 环境要求

- Node.js `^22.19.0` 或 `>=24`
- 安装了 `@deepseek-ai/dsh-subagent` 的 DeepSeek Harness
- Obsidian 桌面端已启用 FlowText Agent Gateway
- FlowText Gateway 访问令牌

## 安装

将插件安装到需要使用 FlowText 的 Harness Profile：

```sh
dsh plugin --profile web add dsh-subagent-flowtext
```

在发布到 npm 注册表之前，可直接从公开 GitHub 仓库安装：

```sh
dsh plugin --profile web add github:ytmaps/dsh-subagent-flowtext
```

GitHub 安装会通过 `prepare` 构建 TypeScript 源码。pnpm 10 及更高版本会默认禁止依赖构建脚本；如果首次命令输出 `allowBuilds` 提示，请把它打印的精确包键加入该 Profile 的 `pnpm-workspace.yaml`，然后重新执行安装命令。生产部署建议锁定具体 commit，避免自动跟随 `main` 后续变更。

安装后的 Provider 配置行默认禁用，防止尚未配置令牌时导致 Harness 启动失败。请在仓库外设置令牌，然后在 Profile 的 `cordis.patch.yml` 中替换或启用该配置行：

```sh
export FLOWTEXT_AGENT_TOKEN='从-FlowText-设置中复制'
```

```yaml
- id: subagent-flowtext
  name: dsh-subagent-flowtext
  config:
    providerName: flowtext
    baseUrl: http://127.0.0.1:27124/flowtext-agent/v1
    token: !!js process.env.FLOWTEXT_AGENT_TOKEN
    approvalDecision: deny
    policy:
      allowRead: true
      allowWrite: true
      allowWeb: true
      allowCli: false
      allowImageGeneration: false
      deniedPaths:
        - .obsidian
```

在对应的 Agent Preset 或 Profile 层将模型工具绑定到该 Provider：

```yaml
- id: tool-subagent-flowtext
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: flowtext
    toolName: subagent_flowtext
    backgroundMode: one-shot
    maxDepth: provider-managed
```

修改组合配置后重启 Profile，父 Agent 即可通过 `subagent_flowtext` 委派任务。

仓库维护者请按 [PUBLISHING.md](PUBLISHING.md) 完成首次 npm 发布，并在后续版本使用无长期令牌的 GitHub Actions 可信发布。

## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `providerName` | `flowtext` | Harness Provider 注册名称。 |
| `baseUrl` | `http://127.0.0.1:27124/flowtext-agent/v1` | FlowText v1 地址。发送令牌前会拒绝非本机 HTTP 地址。 |
| `token` | 必填 | Gateway Bearer Token；应使用环境变量表达式。 |
| `clientId` | `deepseek-harness` | 用于 FlowText 任务恢复的稳定客户端标识。 |
| `modelId` | 未设置 | 每次任务使用的可选 FlowText 模型。 |
| `activePath` | 未设置 | 可选的库内活动笔记路径；不会把父 Session cwd 转成 Obsidian 路径。 |
| `contextPaths` | `[]` | 作为任务上下文的库内相对路径。 |
| `policy` | `{}` | 每次任务的权限请求；FlowText 服务端只能进一步收窄。 |
| `runOptions` | `{}` | `thinkingEnabled` 等 FlowText 运行参数。 |
| `approvalDecision` | `deny` | 自动处理审批：`deny`、`once` 或 `session`。 |
| `requestTimeoutMs` | `30000` | 普通 HTTP 请求超时。 |
| `longPollMs` | `25000` | 事件长轮询时间，上限 30 秒。 |
| `maxResponseBytes` | `2097152` | Gateway 完整响应大小上限。 |
| `maxPromptBytes` | `1048576` | 子任务 UTF-8 提示词上限。 |
| `maxAnswerBytes` | `1048576` | 返回父 Agent 的 UTF-8 答案上限。 |

`policy` 是部署配置固定的任务数据，不是模型可以自行获得的权限。FlowText 会将其与服务端设置取交集，并在工具暴露和实际 Action 执行处同时检查。

## 生命周期与失败处理

只有 FlowText 接受带 `clientId + requestId` 幂等键的任务后，`start()` 才发布远程 Run。Run 通过长轮询等待增量事件，并读取权威任务快照。父请求取消和 `dispose()` 都会请求远端取消并等待本地结果收敛；重复释放是安全的。

一次性 `SubagentProvider` 无法表达 FlowText 的结构化追问，因此遇到追问时会取消远端任务并返回 `stopReason: error`。审批按照 Provider 配置自动处理，默认拒绝。网络、协议、超时、FlowText 重启和答案过大等失败只返回有长度限制的安全诊断，不包含令牌、请求体、文件内容或原始响应。

该 Provider 不声明结构化输出、深度限制、工具过滤、Persona 或父上下文继承能力，也不会实现 `prepareContinuable`。FlowText 持有远端任务，Harness 只持有一次性 Run。

## 模型体验

### 子任务

#### 模型看到什么

FlowText 接收委派的文本块，以及部署固定的模型、上下文、运行参数和权限策略。它不会收到父 Harness 对话记录或父文件系统 cwd。

#### Token 影响

FlowText 模型独立承担 Agent 循环 Token，子任务 Token 不会进入父上下文。

#### KV Cache 影响

与父请求缓存相互独立；复用由 FlowText 的模型适配器、系统指令、工具及任务上下文决定。

### 父任务结果

#### 模型看到什么

前台委派只返回 FlowText 最终答案；非正常结束通过统一子 Agent 错误和有长度限制的安全诊断返回。FlowText 的计划、Action、Observation、任务 ID、事件、日志、Token 和 Gateway Payload 不会复制到父 Session。

#### Token 影响

只有最终答案或错误会增加父上下文。后台任务还会使用 Harness 标准 Job 确认和结果收集消息。

#### KV Cache 影响

结果只追加在可复用的父前缀之后，不改写历史消息。

## 已知限制与后续工作

- 每个 Run 创建一个新 FlowText 任务，不支持远端会话延续或 `prepareContinuable`。
- 只支持文本提示词和文本答案；图片及结构化输出委派会被拒绝。
- 一次性 Provider 没有用户追问通道，因此结构化追问会安全失败。
- 中间进度仅用于唤醒轮询，不会投影到父对话或 UI。
- `approvalDecision: once|session` 属于无人值守授权，必须显式选择；默认值是 `deny`。
- CLI 是 FlowText 的高风险部署权限，可能超出细粒度库路径限制。
