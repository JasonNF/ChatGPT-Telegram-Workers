/**
 * 带超时的 fetch 封装。
 *
 * 背景：项目中存在大量裸 `fetch()` 调用（LLM 请求、Telegram API、
 * 多模态文件下载、远程插件模板拉取），全部没有超时控制。
 * 而两个相关配置项 `CHAT_COMPLETE_API_TIMEOUT` / `TOOL_TIMEOUT`
 * 默认值均为 0（表示不限制）。
 *
 * 后果：上游不返回也不断连时，请求会无限挂起 —— 在 polling 模式下
 * 该会话的串行队列被永久占用，表现为「bot 对这个人彻底失联」，
 * 且没有任何报错。多模态下载路径尤其危险（可能是大文件 + 慢链路）。
 *
 * 方案：统一入口 + AbortSignal.timeout。默认 120s 兜底，
 * 调用方可按场景覆盖。0 或负数表示显式禁用超时（保留原语义）。
 */

/** 默认兜底超时（毫秒）。任何未显式指定的请求都不会无限挂起。 */
export const DEFAULT_FETCH_TIMEOUT_MS = 120_000;

export interface TimeoutFetchInit extends RequestInit {
    /** 超时毫秒数。0 或负数 = 不限制。未指定则用 DEFAULT_FETCH_TIMEOUT_MS。 */
    timeoutMs?: number;
}

export class ResponseBodyTooLargeError extends Error {
    constructor(readonly maxBytes: number) {
        super(`Response body exceeds the ${maxBytes}-byte limit`);
        this.name = 'ResponseBodyTooLargeError';
    }
}

/**
 * 合并调用方传入的 signal 与超时 signal。
 * 优先使用 AbortSignal.any（Node 20+ / Workers 均已支持），
 * 不可用时降级为仅使用超时 signal。
 */
function mergeSignals(external?: AbortSignal | null, timeout?: AbortSignal): AbortSignal | undefined {
    if (!timeout) {
        return external ?? undefined;
    }
    if (!external) {
        return timeout;
    }
    const anyFn = (AbortSignal as any).any;
    if (typeof anyFn === 'function') {
        return anyFn.call(AbortSignal, [external, timeout]);
    }
    return timeout;
}

/**
 * 与原生 fetch 签名兼容，额外支持 `timeoutMs`。
 */
export async function fetchWithTimeout(
    url: RequestInfo | URL,
    init?: TimeoutFetchInit,
): Promise<Response> {
    const { timeoutMs, signal, ...rest } = init ?? {};
    const effective = timeoutMs === undefined ? DEFAULT_FETCH_TIMEOUT_MS : timeoutMs;

    // 显式禁用超时：完全退回原生行为
    if (effective <= 0) {
        return fetch(url, { ...rest, ...(signal ? { signal } : {}) });
    }

    const timeoutSignal = AbortSignal.timeout(effective);
    try {
        return await fetch(url, {
            ...rest,
            signal: mergeSignals(signal, timeoutSignal),
        });
    } catch (e) {
        const err = e as Error;
        // AbortSignal.timeout 抛 TimeoutError，原始信息对用户无意义，补充上下文
        if (err?.name === 'TimeoutError' || (err?.name === 'AbortError' && timeoutSignal.aborted)) {
            const target = typeof url === 'string' ? url : (url as Request)?.url ?? String(url);
            const host = (() => {
                try {
                    return new URL(target).host;
                } catch {
                    return target;
                }
            })();
            throw new Error(`Request to ${host} timed out after ${effective}ms`);
        }
        if (err instanceof Error) {
            const safeMessage = err.message.replace(/\/(?:file\/)?bot\d+:[^/\s]+/g, '/bot[REDACTED]');
            if (safeMessage !== err.message) {
                const safeError = new Error(safeMessage);
                safeError.name = err.name;
                throw safeError;
            }
        }
        throw err;
    }
}

/**
 * 把秒为单位的配置值转成毫秒；0 / 空值回落到默认兜底超时。
 *
 * 注意：项目里 `CHAT_COMPLETE_API_TIMEOUT` 等配置默认为 0（不限制），
 * 直接沿用会让修复失效，因此这里把 0 解释为「使用默认兜底」而非「无限等待」。
 */
export function timeoutMsFromSeconds(seconds?: number | null): number {
    if (!seconds || seconds <= 0) {
        return DEFAULT_FETCH_TIMEOUT_MS;
    }
    return seconds * 1000;
}

/**
 * 在读取响应流时强制限制字节数，既校验 Content-Length，也覆盖分块传输。
 * 这避免先把不受控的大文件完整载入内存后才检查大小。
 */
export async function readResponseBytesWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new TypeError('maxBytes must be a positive safe integer');
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new ResponseBodyTooLargeError(maxBytes);
    }

    if (!response.body) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > maxBytes) {
            throw new ResponseBodyTooLargeError(maxBytes);
        }
        return bytes;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel().catch(() => undefined);
                throw new ResponseBodyTooLargeError(maxBytes);
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}
