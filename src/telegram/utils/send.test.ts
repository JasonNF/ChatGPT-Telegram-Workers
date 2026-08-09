import type * as Telegram from 'telegram-bot-api-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEGMENTATION_MARK, TRAILING_CUSTOM_EMOJI_ANCHOR } from './md2tgmd';
import { MessageSender } from './send';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('message sender editable thinking message', () => {
    it('reuses the placeholder and places the final emoji before the native footer', async () => {
        const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            const method = url.slice(url.lastIndexOf('/') + 1);
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            calls.push({ method, body });
            return new Response(JSON.stringify({
                ok: true,
                result: {
                    message_id: 777,
                    date: 0,
                    chat: { id: 42, type: 'private' },
                },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }));

        const sender = MessageSender.from('123456:test-token', {
            message_id: 1,
            date: 0,
            chat: { id: 42, type: 'private' },
            text: 'test',
        } as Telegram.Message);
        const entities: Telegram.MessageEntity[] = [{
            type: 'custom_emoji',
            offset: 0,
            length: 2,
            custom_emoji_id: 'custom-id',
        }];

        await sender.sendTextWithEntities('🔴 .', entities);
        await sender.sendTextWithEntities('🔴 ..', entities);
        await sender.sendRichText([
            `收到，测试正常。${TRAILING_CUSTOM_EMOJI_ANCHOR}`,
            SEGMENTATION_MARK,
            '>`gpt-5.6-terra 4.0s ttfc 3.6s`',
            '>`↑ 139 (cache 0 0.0%) · ↓ 125 (think 88)`',
        ].join('\n'), undefined, 'chat', {
            addQuote: false,
            quoteExpandable: false,
            trailingCustomEmojiId: '5170338015255463564',
        });

        expect(calls.map(call => call.method)).toEqual([
            'sendMessage',
            'editMessageText',
            'editMessageText',
        ]);
        expect(calls[0].body).toMatchObject({
            chat_id: 42,
            text: '🔴 .',
            entities,
        });
        expect(calls[1].body).toMatchObject({
            chat_id: 42,
            message_id: 777,
            text: '🔴 ..',
            entities,
        });
        expect(calls[2].body).toMatchObject({
            chat_id: 42,
            message_id: 777,
            text: [
                '收到，测试正常。 ![🔴](tg://emoji?id=5170338015255463564)',
                '',
                '>`gpt-5.6-terra 4.0s ttfc 3.6s`',
                '>`↑ 139 (cache 0 0.0%) · ↓ 125 (think 88)`',
            ].join('\n'),
        });
        expect(sender.context.sentMessageIds).toEqual([777]);
    });
});
