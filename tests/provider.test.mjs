import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { FlowTextClient, FlowTextClientError } from '../dist/client.js'
import { FileCredentialStore } from '../dist/credentials.js'
import {
  FLOWTEXT_DIRECT_MODEL,
  FLOWTEXT_DIRECT_PROVIDER,
  FlowTextDirectAdapter,
  apply,
} from '../dist/index.js'
import { startFlowTextRun } from '../dist/run.js'

const TOKEN = 'test-token-'.padEnd(64, 'x')
const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => {
    server.close(resolve)
    server.closeAllConnections()
  })))
})

async function gateway(handler) {
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, `Bearer ${TOKEN}`)
      await handler(request, response)
    } catch (error) {
      response.statusCode = 500
      response.end(JSON.stringify({ error: { code: 'TEST_ERROR', message: error.message } }))
    }
  })
  servers.push(server)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return `http://127.0.0.1:${address.port}/flowtext-agent/v1`
}

function json(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  response.end(payload)
}

function client(baseUrl, overrides = {}) {
  return new FlowTextClient({
    baseUrl,
    token: TOKEN,
    requestTimeoutMs: 500,
    longPollMs: 10,
    maxResponseBytes: 64 * 1024,
    ...overrides,
  })
}

function runSpec(flowtextClient, overrides = {}) {
  return {
    client: flowtextClient,
    clientId: 'test-harness',
    contextPaths: [],
    policy: { allowCli: false },
    runOptions: {},
    approvalDecision: 'deny',
    maxPromptBytes: 4096,
    maxAnswerBytes: 4096,
    ...overrides,
  }
}

function request(signal = new AbortController().signal) {
  return {
    prompt: [{ type: 'text', text: 'Summarize A.md' }],
    signal,
    descriptor: {},
    parent: {},
  }
}

test('client rejects a non-loopback endpoint before sending the token', () => {
  assert.throws(() => client('https://example.com/flowtext-agent/v1'), /loopback http URL/)
})

test('Cordis plugin registers a remote provider with no unsupported capabilities', () => {
  let provider
  let adapter
  let requestListener
  apply({
    subagents: { registerProvider(value) { provider = value; return () => undefined } },
    llm: { registerAdapter(routes, value) { assert.deepEqual(routes, [FLOWTEXT_DIRECT_PROVIDER]); adapter = value; return () => undefined } },
    on(event, listener) { assert.equal(event, 'agent/request'); requestListener = listener; return () => undefined },
    logger: { warn() {} },
  }, {})
  assert.equal(provider.name, 'flowtext')
  assert.equal(provider.inheritsParentContext, false)
  assert.deepEqual(provider.capabilities, {
    outputSchema: false,
    depthLimit: false,
    toolFilter: false,
    persona: false,
  })
  assert.equal(provider.prepareContinuable, undefined)
  assert.ok(adapter instanceof FlowTextDirectAdapter)
  assert.equal(typeof requestListener, 'function')
})

test('direct mode forces the FlowText route and removes inherited reasoning effort', async () => {
  let requestListener
  apply({
    subagents: { registerProvider() { return () => undefined } },
    llm: { registerAdapter() { return () => undefined } },
    on(_event, listener) { requestListener = listener; return () => undefined },
    logger: { warn() {} },
  }, {})
  const routed = await requestListener({}, async () => ({
    provider: 'deepseek',
    model: 'deepseek-chat',
    reasoningEffort: 'high',
    temperature: 0.2,
  }))
  assert.deepEqual(routed, {
    provider: FLOWTEXT_DIRECT_PROVIDER,
    model: FLOWTEXT_DIRECT_MODEL,
    temperature: 0.2,
  })
})

test('tool mode keeps the direct adapter selectable without forcing the DSH route', () => {
  let adapterRegistered = false
  let requestListenerRegistered = false
  apply({
    subagents: { registerProvider() { return () => undefined } },
    llm: { registerAdapter() { adapterRegistered = true; return () => undefined } },
    on() { requestListenerRegistered = true; return () => undefined },
    logger: { warn() {} },
  }, { directMode: false })
  assert.equal(adapterRegistered, true)
  assert.equal(requestListenerRegistered, false)
})

test('client pairs once, persists the credential, and reuses it for requests', async () => {
  let pairCount = 0
  let saved
  const store = {
    async load() { return saved },
    async save(_baseUrl, token) { saved = token },
    async clear() { saved = undefined },
  }
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/flowtext-agent/v1/pair') {
      pairCount += 1
      assert.equal(req.headers.authorization, undefined)
      assert.equal(req.headers['content-type'], 'application/json')
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString('utf8')), {
        clientId: 'test-harness',
        clientName: 'DeepSeek Harness',
      })
      json(res, 200, { token: TOKEN, tokenType: 'Bearer' })
      return
    }
    assert.equal(req.headers.authorization, `Bearer ${TOKEN}`)
    json(res, 200, { task: { taskId: 'paired', clientId: 'test-harness', status: 'running', lastSeq: 1 } })
  })
  servers.push(server)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}/flowtext-agent/v1`
  const paired = new FlowTextClient({
    baseUrl,
    autoPair: true,
    clientId: 'test-harness',
    clientName: 'DeepSeek Harness',
    credentialStore: store,
    requestTimeoutMs: 500,
    longPollMs: 10,
    maxResponseBytes: 64 * 1024,
  })
  assert.equal((await paired.getTask('paired', new AbortController().signal)).taskId, 'paired')
  assert.equal((await paired.getTask('paired', new AbortController().signal)).taskId, 'paired')
  assert.equal(pairCount, 1)
  assert.equal(saved, TOKEN)
})

test('file credential store persists only the matching endpoint with owner-only permissions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowtext-credential-'))
  try {
    const path = join(directory, 'nested', 'credential.json')
    const store = new FileCredentialStore(path)
    const baseUrl = 'http://127.0.0.1:27124/flowtext-agent/v1'
    await store.save(baseUrl, TOKEN)
    assert.equal(await store.load(baseUrl), TOKEN)
    assert.equal(await store.load('http://127.0.0.1:27125/flowtext-agent/v1'), undefined)
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    await store.clear(baseUrl)
    assert.equal(await store.load(baseUrl), undefined)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('provider returns the terminal FlowText answer and sends an idempotency key', async () => {
  let createdBody
  const baseUrl = await gateway(async (req, res) => {
    if (req.method === 'POST' && req.url === '/flowtext-agent/v1/tasks') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      createdBody = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      json(res, 202, { task: { taskId: 'flow-1', clientId: 'test-harness', status: 'running', lastSeq: 2 } })
      return
    }
    if (req.url.startsWith('/flowtext-agent/v1/tasks/flow-1/events')) {
      json(res, 200, { taskId: 'flow-1', events: [{ taskId: 'flow-1', seq: 3, type: 'task.completed', timestamp: 1 }], lastSeq: 3 })
      return
    }
    if (req.url === '/flowtext-agent/v1/tasks/flow-1') {
      json(res, 200, { task: { taskId: 'flow-1', clientId: 'test-harness', status: 'completed', lastSeq: 3, result: { success: true, answer: 'Summary complete' } } })
      return
    }
    throw new Error(`unexpected route ${req.method} ${req.url}`)
  })
  const run = await startFlowTextRun(request(), runSpec(client(baseUrl)))
  const result = await run.result
  assert.equal(run.id, 'flow-1')
  assert.equal(run.localAgent, undefined)
  assert.deepEqual(result, { output: [{ type: 'text', text: 'Summary complete' }], stopReason: 'completed' })
  assert.equal(createdBody.clientId, 'test-harness')
  assert.match(createdBody.requestId, /^[0-9a-f-]{36}$/)
  assert.equal(createdBody.goal, 'Summarize A.md')
  await run.dispose()
})

test('direct adapter sends only the latest real user task and returns the FlowText answer', async () => {
  let createdBody
  const baseUrl = await gateway(async (req, res) => {
    if (req.method === 'POST' && req.url === '/flowtext-agent/v1/tasks') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      createdBody = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      json(res, 202, { task: { taskId: 'flow-direct', clientId: 'test-harness', status: 'running', lastSeq: 1 } })
      return
    }
    if (req.url.startsWith('/flowtext-agent/v1/tasks/flow-direct/events')) {
      json(res, 200, { taskId: 'flow-direct', events: [], lastSeq: 2 })
      return
    }
    if (req.url === '/flowtext-agent/v1/tasks/flow-direct') {
      json(res, 200, { task: { taskId: 'flow-direct', clientId: 'test-harness', status: 'completed', lastSeq: 2, result: { success: true, answer: 'FlowText finished everything' } } })
      return
    }
    throw new Error(`unexpected route ${req.method} ${req.url}`)
  })
  const adapter = new FlowTextDirectAdapter(
    FLOWTEXT_DIRECT_PROVIDER,
    FLOWTEXT_DIRECT_MODEL,
    runSpec(client(baseUrl)),
  )
  assert.deepEqual(adapter.providerRetryPolicy(FLOWTEXT_DIRECT_PROVIDER), {
    mode: 'normal',
    maxRetries: 0,
    retryableCodes: [],
    initialDelayMs: 500,
    maxDelayMs: 10_000,
    jitterRatio: 0,
  })
  const chunks = []
  for await (const chunk of adapter.stream({
    provider: FLOWTEXT_DIRECT_PROVIDER,
    model: FLOWTEXT_DIRECT_MODEL,
    system: 'DSH system prompt that must not be forwarded',
    tools: [{ name: 'read_file', description: 'must not run in DSH', parameters: {} }],
    messages: [
      { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'old task' }] },
      { id: 'a1', role: 'assistant', source: { kind: 'model', provider: 'deepseek', model: 'chat' }, content: [{ type: 'text', text: 'old answer' }] },
      { id: 'p1', role: 'user', source: { kind: 'plugin', plugin: 'context' }, content: [{ type: 'text', text: 'plugin context' }] },
      { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'do the complete new task' }] },
    ],
  })) chunks.push(chunk)
  assert.equal(createdBody.goal, 'do the complete new task')
  assert.deepEqual(chunks, [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'FlowText finished everything' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'FlowText finished everything' } },
    { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
})

test('provider resolves a FlowText approval with the configured fail-closed decision', async () => {
  let decision
  let status = 'waiting_approval'
  const baseUrl = await gateway(async (req, res) => {
    if (req.method === 'POST' && req.url === '/flowtext-agent/v1/tasks') {
      json(res, 202, { task: { taskId: 'flow-approval', clientId: 'test-harness', status, lastSeq: 2, pendingApproval: { requestId: 'approval-1', kind: 'external_action', command: 'Edit A.md' } } })
      return
    }
    if (req.method === 'POST' && req.url.endsWith('/approvals/approval-1/resolve')) {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      decision = JSON.parse(Buffer.concat(chunks).toString('utf8')).decision
      status = 'completed'
      json(res, 200, { task: { taskId: 'flow-approval', status: 'running', lastSeq: 4 } })
      return
    }
    if (req.url.includes('/events?')) {
      json(res, 200, { taskId: 'flow-approval', events: [], lastSeq: 4 })
      return
    }
    if (req.url === '/flowtext-agent/v1/tasks/flow-approval') {
      json(res, 200, { task: { taskId: 'flow-approval', clientId: 'test-harness', status, lastSeq: 5, result: { success: true, answer: 'Write was denied safely' } } })
      return
    }
    throw new Error(`unexpected route ${req.method} ${req.url}`)
  })
  const run = await startFlowTextRun(request(), runSpec(client(baseUrl)))
  assert.equal((await run.result).stopReason, 'completed')
  assert.equal(decision, 'deny')
})

test('provider cancels a task that requires unsupported user clarification', async () => {
  let cancelled = false
  const baseUrl = await gateway(async (req, res) => {
    if (req.method === 'POST' && req.url === '/flowtext-agent/v1/tasks') {
      json(res, 202, { task: { taskId: 'flow-input', clientId: 'test-harness', status: 'waiting_input', lastSeq: 3, pendingInteraction: { requestId: 'ask-1' } } })
      return
    }
    if (req.method === 'POST' && req.url.endsWith('/cancel')) {
      cancelled = true
      json(res, 200, { task: { taskId: 'flow-input', status: 'cancelled', lastSeq: 4 } })
      return
    }
    throw new Error(`unexpected route ${req.method} ${req.url}`)
  })
  const run = await startFlowTextRun(request(), runSpec(client(baseUrl)))
  const result = await run.result
  assert.equal(result.stopReason, 'error')
  assert.match(result.diagnostic, /FLOWTEXT_INPUT_REQUIRED/)
  assert.equal(cancelled, true)
})

test('request cancellation cancels the remote task and dispose reaches settlement', async () => {
  const owner = new AbortController()
  let cancelled = false
  const baseUrl = await gateway(async (req, res) => {
    if (req.method === 'POST' && req.url === '/flowtext-agent/v1/tasks') {
      json(res, 202, { task: { taskId: 'flow-cancel', clientId: 'test-harness', status: 'running', lastSeq: 2 } })
      return
    }
    if (req.method === 'POST' && req.url.endsWith('/cancel')) {
      cancelled = true
      json(res, 200, { task: { taskId: 'flow-cancel', status: 'cancelled', lastSeq: 3 } })
      return
    }
    if (req.url.includes('/events?')) {
      setTimeout(() => {
        if (!res.writableEnded) json(res, 200, { taskId: 'flow-cancel', events: [], lastSeq: 2 })
      }, 50)
      return
    }
    throw new Error(`unexpected route ${req.method} ${req.url}`)
  })
  const run = await startFlowTextRun(request(owner.signal), runSpec(client(baseUrl)))
  owner.abort()
  const result = await run.result
  assert.equal(result.stopReason, 'aborted')
  await run.dispose()
  assert.equal(cancelled, true)
})

test('client rejects an oversized response without retaining its payload', async () => {
  const baseUrl = await gateway(async (_req, res) => {
    json(res, 200, { task: { taskId: 'x'.repeat(2048), status: 'running', lastSeq: 1 } })
  })
  await assert.rejects(
    client(baseUrl, { maxResponseBytes: 128 }).getTask('x', new AbortController().signal),
    error => error instanceof FlowTextClientError && error.code === 'RESPONSE_TOO_LARGE',
  )
})

test('client rejects non-monotonic event cursors at the Gateway trust boundary', async () => {
  const baseUrl = await gateway(async (_req, res) => {
    json(res, 200, {
      taskId: 'flow-events',
      events: [
        { taskId: 'flow-events', seq: 3, type: 'task.running', timestamp: 1 },
        { taskId: 'flow-events', seq: 2, type: 'task.started', timestamp: 2 },
      ],
      lastSeq: 3,
    })
  })
  await assert.rejects(
    client(baseUrl).waitForEvents('flow-events', 1, new AbortController().signal),
    error => error instanceof FlowTextClientError && error.code === 'INVALID_RESPONSE',
  )
})
