import type * as Telegram from 'telegram-bot-api-types';
import { describe, expect, it, vi } from 'vitest';
import {
    pollingBackoffMs,
    processPollingResponse,
    redactTelegramSecrets,
} from './polling';

function update(id: number): Telegram.Update {
    return { update_id: id } as Telegram.Update;
}

describe('pollingBackoffMs', () => {
    it('指数增长、带 jitter 且封顶 30 秒', () => {
        expect(pollingBackoffMs(1, () => 0)).toBe(1000);
        expect(pollingBackoffMs(2, () => 0.5)).toBe(2200);
        expect(pollingBackoffMs(20, () => 1)).toBe(30_000);
    });
});

describe('processPollingResponse', () => {
    it('等待同批 updates 全部处理完成后才推进 offset', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const handler = vi.fn(async (item: Telegram.Update) => {
            if (item.update_id === 8) {
                await gate;
            }
        });
        const response = Response.json({ ok: true, result: [update(7), update(8)] });
        let settled = false;
        const processing = processPollingResponse(response, 7, handler).then((offset) => {
            settled = true;
            return offset;
        });

        await Promise.resolve();
        expect(settled).toBe(false);
        release();
        await expect(processing).resolves.toBe(9);
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it('429 同时支持响应体 retry_after', async () => {
        const response = Response.json(
            { ok: false, error_code: 429, parameters: { retry_after: 3 } },
            { status: 429 },
        );
        await expect(processPollingResponse(response, 0, async () => undefined))
            .rejects
            .toMatchObject({ retryAfterMs: 3000 });
    });

    it('非 2xx 响应抛出状态明确、长度受控的错误', async () => {
        const response = Response.json({ ok: false, description: 'upstream unavailable' }, { status: 503 });
        await expect(processPollingResponse(response, 0, async () => undefined))
            .rejects
            .toThrow('HTTP 503: upstream unavailable');
    });
});

it('日志脱敏不会留下 Telegram Bot Token', () => {
    const token = '123456:super-secret';
    const value = redactTelegramSecrets(`failed at https://api.telegram.org/bot${token}/getUpdates`, token);
    expect(value).not.toContain(token);
    expect(value).toContain('[REDACTED]');
    expect(redactTelegramSecrets('ordinary startup failure', '')).toBe('ordinary startup failure');
});
