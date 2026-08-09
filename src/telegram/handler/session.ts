import type * as Telegram from 'telegram-bot-api-types';
import { ENV } from '../../config/env';

/**
 * 推导会话级串行 key，粒度必须与 ShareContext 的历史/配置存储键一致。
 * key 仅保留公开的 Bot ID，不把完整 Bot Token 留在队列键中。
 */
export function sessionKeyOf(token: string, update: Telegram.Update): string {
    const message = update.message
        ?? update.callback_query?.message
        ?? update.edited_message;
    const chat = message?.chat;
    const from = update.message?.from
        ?? update.callback_query?.from
        ?? update.inline_query?.from
        ?? update.chosen_inline_result?.from;

    const botId = /^\d+:/.exec(token)?.[0].slice(0, -1) ?? 'unknown-bot';
    const chatId = chat?.id ?? from?.id ?? 'unknown';
    let key = `${botId}:${chatId}`;

    if (
        (chat?.type === 'group' || chat?.type === 'supergroup')
        && !ENV.GROUP_CHAT_BOT_SHARE_MODE
        && from?.id
    ) {
        key += `:${from.id}`;
    }
    const isTopicMessage = message && 'is_topic_message' in message && message.is_topic_message;
    const threadId = message && 'message_thread_id' in message ? message.message_thread_id : undefined;
    if (chat?.is_forum && isTopicMessage && threadId) {
        key += `:${threadId}`;
    }
    return key;
}
