/** A safe HTTP failure that never includes credentials or raw response bodies. */
export class FlowTextClientError extends Error {
    code;
    status;
    constructor(message, code, status) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = 'FlowTextClientError';
    }
}
const TASK_STATUSES = new Set([
    'queued',
    'starting',
    'running',
    'waiting_input',
    'waiting_approval',
    'completed',
    'failed',
    'cancelled',
    'timed_out',
    'interrupted',
]);
function assertRecord(value, label) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new FlowTextClientError(`${label} is not an object`, 'INVALID_RESPONSE');
    }
}
function assertTask(value) {
    assertRecord(value, 'FlowText task');
    if (typeof value.taskId !== 'string'
        || value.taskId.length === 0
        || typeof value.status !== 'string'
        || !TASK_STATUSES.has(value.status)
        || !Number.isSafeInteger(value.lastSeq)
        || Number(value.lastSeq) < 0) {
        throw new FlowTextClientError('FlowText task is missing required fields', 'INVALID_RESPONSE');
    }
    if (value.result !== undefined) {
        assertRecord(value.result, 'FlowText task result');
        if (typeof value.result.success !== 'boolean' || typeof value.result.answer !== 'string') {
            throw new FlowTextClientError('FlowText task result is invalid', 'INVALID_RESPONSE');
        }
    }
    if (value.error !== undefined) {
        assertRecord(value.error, 'FlowText task error');
        if (typeof value.error.code !== 'string' || typeof value.error.message !== 'string') {
            throw new FlowTextClientError('FlowText task error is invalid', 'INVALID_RESPONSE');
        }
    }
    if (value.pendingApproval !== undefined) {
        assertRecord(value.pendingApproval, 'FlowText pending approval');
        if (typeof value.pendingApproval.requestId !== 'string'
            || value.pendingApproval.requestId.length === 0
            || (value.pendingApproval.kind !== 'dangerous_cli' && value.pendingApproval.kind !== 'external_action')
            || typeof value.pendingApproval.command !== 'string') {
            throw new FlowTextClientError('FlowText pending approval is invalid', 'INVALID_RESPONSE');
        }
    }
    return value;
}
function assertLoopbackBaseUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error('subagent-flowtext: baseUrl must be an absolute URL');
    }
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
    if (url.protocol !== 'http:' || !loopback || url.username || url.password || url.search || url.hash) {
        throw new Error('subagent-flowtext: baseUrl must be a credential-free loopback http URL');
    }
    return url.toString().replace(/\/$/, '');
}
async function readJson(response, maxBytes) {
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > maxBytes) {
        throw new FlowTextClientError('FlowText response exceeds maxResponseBytes', 'RESPONSE_TOO_LARGE', response.status);
    }
    if (response.body === null)
        throw new FlowTextClientError('FlowText returned an empty response', 'INVALID_RESPONSE', response.status);
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const item = await reader.read();
        if (item.done)
            break;
        total += item.value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new FlowTextClientError('FlowText response exceeds maxResponseBytes', 'RESPONSE_TOO_LARGE', response.status);
        }
        chunks.push(item.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    }
    catch {
        throw new FlowTextClientError('FlowText returned invalid JSON', 'INVALID_RESPONSE', response.status);
    }
}
function boundedMessage(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 512);
}
/** Minimal authenticated client for FlowText Agent Gateway v1. */
export class FlowTextClient {
    options;
    baseUrl;
    constructor(options) {
        this.options = options;
        this.baseUrl = assertLoopbackBaseUrl(options.baseUrl);
        if (options.token.length < 24)
            throw new Error('subagent-flowtext: token must contain at least 24 characters');
    }
    /** Create or recover an idempotent task. */
    async createTask(input, signal) {
        const body = await this.request('POST', '/tasks', input, signal);
        assertRecord(body, 'FlowText create response');
        return assertTask(body.task);
    }
    /** Read one current task snapshot. */
    async getTask(taskId, signal) {
        const body = await this.request('GET', `/tasks/${encodeURIComponent(taskId)}`, undefined, signal);
        assertRecord(body, 'FlowText task response');
        return assertTask(body.task);
    }
    /** Wait for task events newer than `after`. */
    async waitForEvents(taskId, after, signal) {
        const query = new URLSearchParams({ after: String(after), waitMs: String(this.options.longPollMs) });
        const body = await this.request('GET', `/tasks/${encodeURIComponent(taskId)}/events?${query}`, undefined, signal, this.options.longPollMs + this.options.requestTimeoutMs);
        assertRecord(body, 'FlowText events response');
        if (!Array.isArray(body.events) || typeof body.lastSeq !== 'number' || typeof body.taskId !== 'string') {
            throw new FlowTextClientError('FlowText events response is missing required fields', 'INVALID_RESPONSE');
        }
        let previousSeq = after;
        const events = body.events.filter((event) => {
            if (event === null || typeof event !== 'object')
                return false;
            const candidate = event;
            const valid = candidate.taskId === taskId
                && Number.isSafeInteger(candidate.seq)
                && Number(candidate.seq) > previousSeq
                && typeof candidate.type === 'string'
                && Number.isFinite(candidate.timestamp);
            if (valid)
                previousSeq = Number(candidate.seq);
            return valid;
        });
        if (events.length !== body.events.length)
            throw new FlowTextClientError('FlowText returned an invalid task event', 'INVALID_RESPONSE');
        if (body.taskId !== taskId || !Number.isSafeInteger(body.lastSeq) || Number(body.lastSeq) < previousSeq) {
            throw new FlowTextClientError('FlowText events cursor is invalid', 'INVALID_RESPONSE');
        }
        return { taskId: body.taskId, events, lastSeq: body.lastSeq };
    }
    /** Request cancellation with an operation-owned timeout. */
    async cancelTask(taskId) {
        await this.request('POST', `/tasks/${encodeURIComponent(taskId)}/cancel`, {}, AbortSignal.timeout(this.options.requestTimeoutMs));
    }
    /** Resolve a pending FlowText approval. */
    async resolveApproval(taskId, requestId, decision, signal) {
        await this.request('POST', `/tasks/${encodeURIComponent(taskId)}/approvals/${encodeURIComponent(requestId)}/resolve`, { decision }, signal);
    }
    async request(method, path, body, signal, timeoutMs = this.options.requestTimeoutMs) {
        const timeout = AbortSignal.timeout(timeoutMs);
        const combined = AbortSignal.any([signal, timeout]);
        let response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: {
                    authorization: `Bearer ${this.options.token}`,
                    accept: 'application/json',
                    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                signal: combined,
            });
        }
        catch (error) {
            if (signal.aborted)
                throw new FlowTextClientError('FlowText request was aborted', 'ABORTED');
            if (timeout.aborted)
                throw new FlowTextClientError('FlowText request timed out', 'REQUEST_TIMEOUT');
            const message = error instanceof Error ? boundedMessage(error.message) : 'network failure';
            throw new FlowTextClientError(`FlowText request failed: ${message}`, 'NETWORK_ERROR');
        }
        const payload = await readJson(response, this.options.maxResponseBytes);
        if (!response.ok) {
            let code = 'HTTP_ERROR';
            let message = `FlowText returned HTTP ${response.status}`;
            if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
                const error = payload.error;
                if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
                    const detail = error;
                    if (typeof detail.code === 'string')
                        code = boundedMessage(detail.code) || code;
                    if (typeof detail.message === 'string')
                        message = boundedMessage(detail.message) || message;
                }
            }
            throw new FlowTextClientError(message, code, response.status);
        }
        return payload;
    }
}
//# sourceMappingURL=client.js.map