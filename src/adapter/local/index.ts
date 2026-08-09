import type { TelegramBotAPI } from '../../telegram/api';
import * as fs from 'node:fs';
import { createCache } from 'cf-worker-adapter/cache';
import { installFetchProxy } from 'cf-worker-adapter/proxy';
import { defaultRequestBuilder, initEnv, startServerV2 } from 'cf-worker-adapter/serve';
import { schedule } from 'node-cron';
import worker from '../../';
import { ENV } from '../../config/env';
import { createRouter } from '../../route/index';
import { createTelegramBotAPI } from '../../telegram/api';
import { handleUpdate } from '../../telegram/handler';
import { withSerialWrites } from '../../utils/cache/serial';
import { redactTelegramSecrets, runPollingLoop } from './polling';

const {
    CONFIG_PATH = '/app/config.json',
    TOML_PATH = '/app/config.toml',
} = process.env;

interface Config {
    database: {
        type: 'memory' | 'local' | 'sqlite' | 'redis';
        path?: string;
    };
    server?: {
        hostname?: string;
        port?: number;
        baseURL: string;
    };
    proxy?: string;
    mode: 'webhook' | 'polling';
}

// 读取配置文件
const config: Config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

if (config.proxy) {
    installFetchProxy(config.proxy);
}

// 初始化数据库
// withSerialWrites 为纵深防御第二道：串行化同一 key 的写入，
// 防止定时任务与消息处理同时落盘导致数据撕裂。
// 会话级临界区由 handleUpdate 中的 sessionQueue 保证。
const cache = withSerialWrites(createCache(config?.database?.type, {
    uri: config.database.path || '',
}));
console.log(`database: ${config?.database?.type} is ready`);

// 初始化环境变量
const env = initEnv(TOML_PATH, { DATABASE: cache });
ENV.merge(env);

// long polling 模式
async function runPolling() {
    const clients: Record<string, TelegramBotAPI> = {};
    for (const token of ENV.TELEGRAM_AVAILABLE_TOKENS) {
        const api = createTelegramBotAPI(token);
        clients[token] = api;
        const name = await api.getMeWithReturns();
        if (!name.ok || !name.result?.username) {
            throw new Error('Telegram getMe failed during polling startup');
        }
        const deleteWebhookResponse = await api.deleteWebhook({});
        if (!deleteWebhookResponse.ok) {
            throw new Error(`Telegram deleteWebhook failed with HTTP ${deleteWebhookResponse.status}`);
        }
        console.log(`@${name.result.username} Webhook deleted, If you want to use webhook, please set it up again.`);
    }

    writePollingHeartbeat();
    await Promise.all(ENV.TELEGRAM_AVAILABLE_TOKENS.map(token => runPollingLoop({
        client: clients[token],
        token,
        handleUpdate,
        heartbeat: writePollingHeartbeat,
    })));
}

const heartbeatPath = process.env.HEARTBEAT_PATH || '/tmp/tg-bot-heartbeat';
function writePollingHeartbeat() {
    try {
        fs.writeFileSync(heartbeatPath, String(Date.now()), { mode: 0o600 });
    } catch (error) {
        console.error(`Failed to write polling heartbeat: ${redactTelegramSecrets(error, '')}`);
    }
}

try {
    // 定时任务
    if (env.EXPIRED_TIME > 0 && env.CRON_CHECK_TIME) {
        try {
            schedule(env.CRON_CHECK_TIME, async () => await worker.scheduled({} as Event, env, null));
        } catch (e) {
            console.error('Failed to schedule cron job:', e);
        }
    }
} catch (e) {
    console.log(e);
}

// 启动服务
if (config.mode === 'webhook' && config.server !== undefined) {
    const router = createRouter();
    startServerV2(
        config.server.port || 8787,
        config.server.hostname || '0.0.0.0',
        env,
        { baseURL: config.server.baseURL },
        defaultRequestBuilder,
        router.fetch.bind(router),
    );
} else {
    runPolling().catch((error) => {
        console.error(`Polling startup failed: ${redactTelegramSecrets(error, '')}`);
        process.exit(1);
    });
}
