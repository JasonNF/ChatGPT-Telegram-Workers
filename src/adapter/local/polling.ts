import type * as Telegram from 'telegram-bot-api-types';
import type { TelegramBotAPI } from '../../telegram/api';
import { readResponseBytesWithLimit } from '../../utils/fetch';

const MAX_POLLING_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ERROR_DESCRIPTION_LENGTH = 300;
const MAX_BACKOFF_MS = 30_000;

type Sleep = (milliseconds: number) => Promise<void>;

interface TelegramPollingBody {
    ok?: boolean;
    result?: Telegram.Update[];
    description?: string;
    error_code?: number;
    parameters?: {
        retry_after?: number;
    };
}

export class TelegramPollingError extends Error {
    constructor(message: string, readonly retryAfterMs?: number) {
        super(message);
        this.name = 'TelegramPollingError';
    }
}

export function pollingBackoffMs(failureCount: number, random: () => number = Math.random): number {
    const exponent = Math.max(0, Math.min(failureCount - 1, 10));
    const base = Math.min(MAX_BACKOFF_MS, 1000 * (2 ** exponent));
    const jitter = Math.floor(base * 0.2 * Math.max(0, Math.min(1, random())));
    return Math.min(MAX_BACKOFF_MS, base + jitter);
}

export function redactTelegramSecrets(value: unknown, token: string): string {
    let message = String(value instanceof Error ? value.message : value);
    if (token) {
        message = message.replaceAll(token, '[REDACTED]');
    }
    return message.replace(/\/bot\d+:[^/\s]+/g, '/bot[REDACTED]');
}

async function parsePollingBody(response: Response): Promise<TelegramPollingBody> {
    const bytes = await readResponseBytesWithLimit(response, MAX_POLLING_RESPONSE_BYTES);
    if (bytes.byteLength === 0) {
        return {};
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes)) as TelegramPollingBody;
    } catch {
        throw new TelegramPollingError(`Telegram getUpdates returned invalid JSON (HTTP ${response.status})`);
    }
}

function retryAfterMilliseconds(response: Response, body: TelegramPollingBody): number | undefined {
    const bodySeconds = body.parameters?.retry_after;
    if (typeof bodySeconds === 'number' && Number.isFinite(bodySeconds) && bodySeconds > 0) {
        return bodySeconds * 1000;
    }
    const header = response.headers.get('retry-after');
    if (!header) {
        return undefined;
    }
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) {
        return seconds * 1000;
    }
    const retryAt = Date.parse(header);
    return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : undefined;
}

export async function processPollingResponse(
    response: Response,
    currentOffset: number,
    onUpdate: (update: Telegram.Update) => Promise<unknown>,
    onUpdateError: (error: unknown) => void = console.error,
): Promise<number> {
    const body = await parsePollingBody(response);
    if (response.status === 429 || body.error_code === 429) {
        throw new TelegramPollingError('Telegram getUpdates was rate limited', retryAfterMilliseconds(response, body));
    }
    if (!response.ok || body.ok !== true || !Array.isArray(body.result)) {
        const description = typeof body.description === 'string'
            ? `: ${body.description.slice(0, MAX_ERROR_DESCRIPTION_LENGTH)}`
            : '';
        throw new TelegramPollingError(`Telegram getUpdates failed with HTTP ${response.status}${description}`);
    }

    let nextOffset = currentOffset;
    await Promise.all(body.result.map(async (update) => {
        if (update.update_id >= nextOffset) {
            nextOffset = update.update_id + 1;
        }
        try {
            await onUpdate(update);
        } catch (error) {
            onUpdateError(error);
        }
    }));
    return nextOffset;
}

export async function runPollingLoop({
    client,
    token,
    handleUpdate,
    heartbeat,
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    random = Math.random,
}: {
    client: TelegramBotAPI;
    token: string;
    handleUpdate: (token: string, update: Telegram.Update) => Promise<unknown>;
    heartbeat: () => void;
    sleep?: Sleep;
    random?: () => number;
}): Promise<never> {
    let offset = 0;
    let failureCount = 0;
    while (true) {
        try {
            const response = await client.getUpdates({ offset, timeout: 30 });
            offset = await processPollingResponse(
                response,
                offset,
                update => handleUpdate(token, update),
                error => console.error(`Polling update failed: ${redactTelegramSecrets(error, token)}`),
            );
            failureCount = 0;
            heartbeat();
        } catch (error) {
            failureCount += 1;
            const retryAfterMs = error instanceof TelegramPollingError ? error.retryAfterMs : undefined;
            const delayMs = retryAfterMs === undefined
                ? pollingBackoffMs(failureCount, random)
                : retryAfterMs + Math.floor(random() * 1000);
            console.error(`Polling failed: ${redactTelegramSecrets(error, token)}; retrying in ${delayMs}ms`);
            await sleep(delayMs);
        }
    }
}
