import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, timeoutMsFromSeconds } from './fetch';

describe('timeoutMsFromSeconds', () => {
    it('正数秒转毫秒', () => {
        expect(timeoutMsFromSeconds(30)).toBe(30_000);
    });

    it('0 视为「使用默认兜底」而非「无限等待」', () => {
        // 这是关键行为：项目里 CHAT_COMPLETE_API_TIMEOUT 默认为 0，
        // 若沿用「0 = 不限制」的原语义，超时修复会完全失效。
        expect(timeoutMsFromSeconds(0)).toBe(DEFAULT_FETCH_TIMEOUT_MS);
    });

    it('空值与负数同样回落到默认兜底', () => {
        expect(timeoutMsFromSeconds(undefined)).toBe(DEFAULT_FETCH_TIMEOUT_MS);
        expect(timeoutMsFromSeconds(null)).toBe(DEFAULT_FETCH_TIMEOUT_MS);
        expect(timeoutMsFromSeconds(-1)).toBe(DEFAULT_FETCH_TIMEOUT_MS);
    });
});

describe('fetchWithTimeout', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('超时后抛出带主机名与耗时的可读错误', async () => {
        // 模拟一个永不返回的上游：仅在 signal abort 时 reject
        vi.stubGlobal('fetch', (_url: any, init?: any) => {
            return new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    const err = new Error('aborted');
                    err.name = 'TimeoutError';
                    reject(err);
                });
            });
        });

        await expect(
            fetchWithTimeout('https://example.com/hang', { timeoutMs: 20 }),
        ).rejects.toThrow(/example\.com.*timed out after 20ms/);
    });

    it('timeoutMs <= 0 时保留「不限制」语义，不注入 signal', async () => {
        let receivedSignal: any = 'not-set';
        vi.stubGlobal('fetch', async (_url: any, init?: any) => {
            receivedSignal = init?.signal;
            return new Response('ok');
        });

        const resp = await fetchWithTimeout('https://example.com', { timeoutMs: 0 });
        expect(await resp.text()).toBe('ok');
        expect(receivedSignal).toBeUndefined();
    });

    it('正常返回时原样透传响应', async () => {
        vi.stubGlobal('fetch', async () => new Response('hello', { status: 201 }));
        const resp = await fetchWithTimeout('https://example.com', { timeoutMs: 1000 });
        expect(resp.status).toBe(201);
        expect(await resp.text()).toBe('hello');
    });

    it('非超时错误按原样抛出，不被误判为超时', async () => {
        vi.stubGlobal('fetch', async () => {
            throw new Error('ECONNREFUSED');
        });
        await expect(
            fetchWithTimeout('https://example.com', { timeoutMs: 1000 }),
        ).rejects.toThrow('ECONNREFUSED');
    });
});
