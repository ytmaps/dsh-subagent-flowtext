import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { afterEach, test } from 'node:test'
import { FlowTextClient, FlowTextClientError } from '../dist/client.js'
import { apply } from '../dist/index.js'
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
  apply({
    subagents: { registerProvider(value) { provider = value; return () => undefined } },
    logger: { warn() {} },
  }, { token: TOKEN })
  assert.equal(provider.name, 'flowtext')
  assert.equal(provider.inheritsParentContext, false)
  assert.deepEqual(provider.capabilities, {
    outputSchema: false,
    depthLimit: false,
    toolFilter: false,
    persona: false,
  })
  assert.equal(provider.prepareContinuable, undefined)
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
