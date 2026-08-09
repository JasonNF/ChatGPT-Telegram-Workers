import type * as Telegram from 'telegram-bot-api-types';
import type { MessageHandler } from './types';
import { WorkerContextBase } from '../../config/context';
import { log } from '../../log/logger';
import { sessionQueue } from '../../utils/cache/serial';
import { handleCallbackQuery, handleChosenInlineQuery, handleInlineQuery } from '../query';
import { ChatHandler } from './chat';
import { GroupMention } from './group';
import {
    BlocklistFilter,
    CheckForwarding,
    ChunkMessageHandler,
    CommandHandler,
    EnvChecker,
    InitUserConfig,
    IntelligentModelProcess,
    MergeQuote,
    MessageFilter,
    OldMessageFilter,
    ReplyInlineHandler,
    SaveLastMessage,
    SubstituteHandler,
    TagNeedDelete,
    WhiteListFilter,
} from './handlers';

function loadMessage(body: Telegram.Update, isForwarding: boolean) {
    switch (true) {
        case !!body.message:
            return (token: string) => handleMessage(token, body.message!, isForwarding);
        case !!body.inline_query:
            return (token: string) => handleInlineQuery(token, body.inline_query!);
        case !!body.callback_query:
            return (token: string) => handleCallbackQuery(token, body.callback_query!);
        case !!body.chosen_inline_result:
            return (token: string) => handleChosenInlineQuery(token, body.chosen_inline_result!);
        case !!body.edited_message:
            log.info('Ignore edited message');
            return null;
        default:
            log.info(`Not support message type: ${JSON.stringify(body, null, 2)}`);
            return null;
    }
}

const exitHanders: MessageHandler<any>[] = [new TagNeedDelete()];

/**
 * 推导会话级串行 key。
 *
 * 必须与 ShareContext 中 chatHistoryKey / configStoreKey 的分组粒度一致，
 * 否则同一份历史仍可能被两个队列并发读改写。
 * 这里只需要「同一份历史落在同一个 key」，无需完全等同于存储键名。
 */
function sessionKeyOf(token: string, update: Telegram.Update): string {
    const chat = update.message?.chat
        ?? update.callback_query?.message?.chat
        ?? update.edited_message?.chat;
    const from = update.message?.from
        ?? update.callback_query?.from
        ?? update.inline_query?.from
        ?? update.chosen_inline_result?.from;

    // 无法归属会话时（如 inline query），用发送者兜底，最差退化为按 token 串行
    const chatId = chat?.id ?? from?.id ?? 'unknown';
    let key = `${token}:${chatId}`;

    // 群组未开启共享模式时按发言人分组，与 ShareContext 保持一致
    if ((chat?.type === 'group' || chat?.type === 'supergroup') && from?.id) {
        key += `:${from.id}`;
    }
    // 话题模式下按 thread 分组
    const threadId = update.message?.message_thread_id;
    if (chat?.is_forum && update.message?.is_topic_message && threadId) {
        key += `:${threadId}`;
    }
    return key;
}

export async function handleUpdate(token: string, update: Telegram.Update, headers?: Headers): Promise<Response | null> {
    log.debug(`handleUpdate`, update.message?.chat ?? `callback_query: ${JSON.stringify(update.callback_query?.from, null, 2)}`);
    const isForwarding = headers?.get('User-Agent') === 'Upstash-QStash';
    const messageHandler = loadMessage(update, isForwarding);
    if (!messageHandler) {
        return null;
    }
    // 会话级串行：保证「读历史 -> 调用模型 -> 写历史」是完整临界区。
    // 不同会话仍并发，多用户吞吐不受影响。
    return sessionQueue.run(sessionKeyOf(token, update), () => messageHandler(token));
}

async function handleMessage(token: string, message: Telegram.Message, isForwarding: boolean) {
    // 消息处理中间件
    const SHARE_HANDLER: MessageHandler<any>[] = [
        // 检查环境是否准备好: DATABASE
        new EnvChecker(),
        // 过滤非白名单群组/用户, 提前过滤减少KV消耗
        new WhiteListFilter(),
        // 过滤不支持的消息 抽离文件ID
        new MessageFilter(),
        // 忽略旧消息
        new OldMessageFilter(),
        // 处理回复内联消息
        new ReplyInlineHandler(),
        // 处理群消息，判断是否需要响应此条消息
        new GroupMention(),
        // 处理消息分块
        new ChunkMessageHandler(),
        // DEBUG: 保存最后一条消息,按照需求自行调整此中间件位置
        new SaveLastMessage(),
        // 合并引用消息
        new MergeQuote(),
        // 初始化用户配置
        new InitUserConfig(),
        // 过滤被屏蔽的用户
        new BlocklistFilter(),
        // 替换消息
        new SubstituteHandler(),
        // 动态模型处理
        new IntelligentModelProcess(),
        // 处理命令消息
        new CommandHandler(),
        // 检查是否是转发消息
        new CheckForwarding(),
        // 与llm聊天
        new ChatHandler(),
    ];
    // 延迟初始化用户配置
    const context = new WorkerContextBase(token, message);
    context.SHARE_CONTEXT.isForwarding = isForwarding;
    try {
        for (const handler of SHARE_HANDLER) {
            const result = await handler.handle(message, context);
            if (result instanceof Response) {
                break;
            }
        }

        for (const handler of exitHanders) {
            const result = await handler.handle(message, context);
            if (result && result instanceof Response) {
                return result;
            }
        }
    } catch (e) {
        return catchError(e as Error);
    }

    return null;
}

export function catchError(e: Error) {
    console.error(e.message);
    return new Response(JSON.stringify({
        message: e.message,
        stack: e.stack,
    }), { status: 500 });
}
