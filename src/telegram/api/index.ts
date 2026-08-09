import type * as Telegram from 'telegram-bot-api-types';
import { ENV } from '../../config/env';
import { fetchWithTimeout } from '../../utils/fetch';

/**
 * 普通 Telegram API 调用的超时。
 * 发消息/编辑消息本应在数秒内完成，挂死会拖住整个会话队列。
 */
const TELEGRAM_API_TIMEOUT_MS = 60_000;

/**
 * getUpdates 是长轮询，服务端会挂起到 timeout 参数指定的秒数才返回，
 * 因此必须显式放宽，否则会被误判为超时并造成消息丢失。
 * 取 polling timeout(30s) 的两倍余量。
 */
const TELEGRAM_POLLING_TIMEOUT_MS = 90_000;

function timeoutForMethod(method: Telegram.BotMethod): number {
    return method === 'getUpdates' ? TELEGRAM_POLLING_TIMEOUT_MS : TELEGRAM_API_TIMEOUT_MS;
}

class APIClientBase {
    readonly token: string;
    readonly baseURL: string = ENV.TELEGRAM_API_DOMAIN;

    constructor(token: string, baseURL?: string) {
        this.token = token;
        if (baseURL) {
            this.baseURL = baseURL;
        }
        while (this.baseURL.endsWith('/')) {
            this.baseURL = this.baseURL.slice(0, -1);
        }
        this.request = this.request.bind(this);
        this.requestJSON = this.requestJSON.bind(this);
    }

    private uri(method: Telegram.BotMethod): string {
        return `${this.baseURL}/bot${this.token}/${method}`;
    }

    private jsonRequest<T>(method: Telegram.BotMethod, params: T): Promise<Response> {
        return fetchWithTimeout(this.uri(method), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(params),
            timeoutMs: timeoutForMethod(method),
        });
    }

    private formDataRequest<T>(method: Telegram.BotMethod, params: T): Promise<Response> {
        const formData = new FormData();
        for (const key in params) {
            const value = params[key];
            if (value instanceof File) {
                formData.append(key, value, value.name);
            } else if (value instanceof Blob) {
                formData.append(key, value, 'blob');
            } else if (typeof value === 'string') {
                formData.append(key, value);
            } else if (value) {
                formData.append(key, JSON.stringify(value));
            }
        }
        return fetchWithTimeout(this.uri(method), {
            method: 'POST',
            body: formData,
            timeoutMs: timeoutForMethod(method),
        });
    }

    request<T>(method: Telegram.BotMethod, params: T): Promise<Response> {
        for (const key in params) {
            if (params[key] instanceof File || params[key] instanceof Blob) {
                return this.formDataRequest(method, params);
            }
        }
        return this.jsonRequest(method, params);
    }

    async requestJSON<T, R>(method: Telegram.BotMethod, params: T): Promise<R> {
        return this.request(method, params).then(res => res.json() as R);
    }
}

export type TelegramBotAPI = APIClientBase & Telegram.AllBotMethods;

export function createTelegramBotAPI(token: string): TelegramBotAPI {
    const client = new APIClientBase(token);
    return new Proxy(client, {
        get(target, prop, receiver) {
            if (prop in target) {
                return Reflect.get(target, prop, receiver);
            }
            return (...args: any[]) => {
                if (typeof prop === 'string' && prop.endsWith('WithReturns')) {
                    const method = prop.slice(0, -11) as Telegram.BotMethod;
                    return Reflect.apply(target.requestJSON, target, [method, ...args]);
                }
                return Reflect.apply(target.request, target, [prop as Telegram.BotMethod, ...args]);
            };
        },
    }) as TelegramBotAPI;
}
