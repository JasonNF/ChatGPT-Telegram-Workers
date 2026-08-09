import type * as Telegram from 'telegram-bot-api-types';
import { afterEach, describe, expect, it } from 'vitest';
import { ENV } from '../../config/env';
import { sessionKeyOf } from './session';

const TOKEN = '123456:secret-token-must-not-appear';

function groupUpdate(overrides: Partial<Telegram.Message> = {}): Telegram.Update {
    return {
        update_id: 1,
        message: {
            message_id: 2,
            date: 0,
            chat: { id: -100, type: 'supergroup', title: 'group' },
            from: { id: 42, is_bot: false, first_name: 'user' },
            ...overrides,
        },
    } as Telegram.Update;
}

afterEach(() => {
    ENV.GROUP_CHAT_BOT_SHARE_MODE = true;
});

describe('sessionKeyOf', () => {
    it('共享群聊按群串行，且 key 不包含完整 Token', () => {
        ENV.GROUP_CHAT_BOT_SHARE_MODE = true;
        const key = sessionKeyOf(TOKEN, groupUpdate());
        expect(key).toBe('123456:-100');
        expect(key).not.toContain('secret-token');
    });

    it('非共享群聊按发言人隔离', () => {
        ENV.GROUP_CHAT_BOT_SHARE_MODE = false;
        expect(sessionKeyOf(TOKEN, groupUpdate())).toBe('123456:-100:42');
    });

    it('论坛群按话题 thread 隔离，并继续遵循共享模式', () => {
        const update = groupUpdate({
            chat: { id: -100, type: 'supergroup', title: 'forum', is_forum: true },
            is_topic_message: true,
            message_thread_id: 77,
        });
        ENV.GROUP_CHAT_BOT_SHARE_MODE = true;
        expect(sessionKeyOf(TOKEN, update)).toBe('123456:-100:77');

        ENV.GROUP_CHAT_BOT_SHARE_MODE = false;
        expect(sessionKeyOf(TOKEN, update)).toBe('123456:-100:42:77');
    });
});
