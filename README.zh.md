# dsh-subagent-flowtext

[English](README.md)

`dsh-subagent-flowtext` 默认把 DeepSeek Harness 的每个用户任务直接交给 Obsidian FlowText Agent Gateway。FlowText 独占完整 Agent 循环（计划、查找、读取、写入、工具执行和收尾），DSH 只保留会话/UI 外壳并接收最终答案。插件也保留一次性 `SubagentProvider`，可在关闭直通模式后作为 `subagent_flowtext` 工具使用。

## 环境要求

- Node.js `^22.19.0` 或 `>=24`
- 安装了 `@deepseek-ai/dsh-subagent` 的 DeepSeek Harness
- Obsidian 桌面端已启用 FlowText Agent Gateway

## 安装

将插件安装到需要使用 FlowText 的 Harness Profile：

```sh
dsh plugin --profile web add dsh-subagent-flowtext
```

在发布到 npm 注册表之前，可直接从公开 GitHub 仓库安装：

```sh
dsh plugin --profile web add github:ytmaps/dsh-subagent-flowtext
```

仓库中已包含经审查的预编译 `dist` 入口，因此 GitHub 源安装或插件市场安装不会执行依赖构建脚本，也不需要 pnpm `allowBuilds` 授权。生产部署建议锁定具体 commit，避免自动跟随 `main` 后续变更。

安装包默认开启直通模式，同时保留 Provider 和 `subagent_flowtext` 工具，无需环境变量、复制 Token 或编辑 `cordis.patch.yml`。重启 Harness 后提交任意任务都会直接创建 FlowText 任务，不再依赖 DSH 模型决定是否调用工具。首次任务会让 FlowText 弹出“允许 DeepSeek Harness 连接？”确认框；允许一次后，凭据保存在本机 DSH 凭据目录的 mode-0600 文件中。后续启动自动复用，FlowText 重置 Gateway Token 后也会自动重新配对。

直通模式下，DSH 仍会运行一次最薄的 Agent 请求周期来领取用户消息和记录最终答案，但该周期不会调用 DeepSeek 模型，也不会在 DSH 内执行工具。适配器只把最新一条真实用户消息发送给 FlowText；DSH 系统提示、历史助手消息、插件上下文、工具目录和工具结果均不会转发。

旧版本留下的手写 `subagent-flowtext`、`tool-subagent-flowtext` Profile 覆盖行可以删除，以免覆盖安装包的新默认配置。

仓库维护者请按 [PUBLISHING.md](PUBLISHING.md) 完成首次 npm 发布，并在后续版本使用无长期令牌的 GitHub Actions 可信发布。

## 插件市场发现

DeepSeek Harness 当前使用 GitHub `dsh-plugin` Topic 作为官方明确的社区发现约定；内置 Plugins 设置页只展示已安装的 Loader 条目，并非官方下载市场。独立社区市场可收录本仓库，并使用上述 GitHub 源命令直接安装。市场收录不代表 DeepSeek 的安全背书；安装前应审查本包及其请求的 FlowText 权限策略。

## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `providerName` | `flowtext` | Harness Provider 注册名称。 |
| `directMode` | `true` | 强制所有 DSH Agent 请求走 FlowText 完整任务直通；设为 `false` 恢复可选工具模式。 |
| `directProvider` | `flowtext-direct` | 直通模式使用的 DSH LLM 路由名称。 |
| `directModel` | `flowtext-agent` | 直通模式显示与校验使用的模型标识。 |
| `baseUrl` | `http://127.0.0.1:27124/flowtext-agent/v1` | FlowText v1 地址。发送令牌前会拒绝非本机 HTTP 地址。 |
| `autoPair` | `true` | 未找到本机凭据时，请求 FlowText 弹窗授权并自动保存凭据。 |
| `credentialPath` | `$DSH_HOME/credentials/dsh-subagent-flowtext.json` | 可选的凭据文件覆盖路径；默认文件权限为 mode 0600。 |
| `clientName` | `DeepSeek Harness` | FlowText 配对确认框显示的客户端名称。 |
| `token` | 未设置 | 仅用于旧部署的手动 Bearer Token；普通用户不需要配置。 |
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

当前 Gateway 返回通道无法把 FlowText 的结构化追问传回 DSH 再继续同一任务，因此遇到追问时会取消远端任务并返回错误。审批按照配置自动处理，默认拒绝。网络、协议、超时、FlowText 重启和答案过大等失败只返回有长度限制的安全诊断，不包含令牌、请求体、文件内容或原始响应。

直通适配器将 DSH 的模型请求重试数固定为零，避免包含写操作的完整 FlowText 任务被 DSH 重复执行。单个远端任务仍通过 Gateway 的 `clientId + requestId`、状态快照和取消协议保证一致性。

自动配对只接受本机回环连接，拒绝带浏览器 `Origin` 的请求，并且必须由用户在 Obsidian 中明确允许。凭据不会写入 Profile、仓库、命令历史或模型上下文。

该 Provider 不声明结构化输出、深度限制、工具过滤、Persona 或父上下文继承能力，也不会实现 `prepareContinuable`。FlowText 持有远端任务，Harness 只持有一次性 Run。

## 模型体验

### 直通任务

#### 模型看到什么

FlowText 只接收最新一条真实用户消息，以及部署固定的模型、上下文、运行参数和权限策略。它不会收到 DSH 系统提示、历史对话、插件上下文、工具目录、工具结果或父文件系统 cwd。

#### Token 影响

FlowText 模型独立承担完整 Agent 循环 Token；DSH 不再发起用于执行任务的模型推理。

#### KV Cache 影响

与父请求缓存相互独立；复用由 FlowText 的模型适配器、系统指令、工具及任务上下文决定。

### DSH 最终结果

#### 模型看到什么

DSH 只接收 FlowText 最终答案；非正常结束返回有长度限制的安全诊断。FlowText 的计划、Action、Observation、任务 ID、事件、日志、Token 和 Gateway Payload 不会复制到 DSH Session。

#### Token 影响

只有最终答案或错误会进入 DSH 会话记录。

#### KV Cache 影响

结果只追加在可复用的父前缀之后，不改写历史消息。

## 已知限制与后续工作

- 每条 DSH 用户消息创建一个新 FlowText 任务，不自动把 DSH 历史对话转成 FlowText 远端会话。
- 只支持文本提示词和文本答案；图片及结构化输出委派会被拒绝。
- 一次性 Provider 没有用户追问通道，因此结构化追问会安全失败。
- 中间进度仅用于唤醒轮询，不会投影到父对话或 UI。
- `approvalDecision: once|session` 属于无人值守授权，必须显式选择；默认值是 `deny`。
- CLI 是 FlowText 的高风险部署权限，可能超出细粒度库路径限制。
