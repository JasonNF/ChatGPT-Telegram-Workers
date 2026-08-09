import type { UserModelMessage } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvironmentConfig } from '../../config/config';
import { ENV } from '../../config/env';
import { fileUrlToBase64Message } from './chat';

const TOKEN = '123456:provider-must-not-see-this';
const defaultMode = ENV.TELEGRAM_IMAGE_TRANSFER_MODE;

afterEach(() => {
    ENV.TELEGRAM_IMAGE_TRANSFER_MODE = defaultMode;
    vi.unstubAllGlobals();
});

describe('telegram media provider payload', () => {
    it('默认传输模式是 base64', () => {
        expect(new EnvironmentConfig().TELEGRAM_IMAGE_TRANSFER_MODE).toBe('base64');
    });

    it('即使误配 url，也不会把 /file/bot<TOKEN>/ 发给 provider，且图片只下载一次', async () => {
        ENV.TELEGRAM_IMAGE_TRANSFER_MODE = 'url';
        const fetchMock = vi.fn(async () => new Response(
            Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
            { headers: { 'content-type': 'image/png' } },
        ));
        vi.stubGlobal('fetch', fetchMock);
        const params: UserModelMessage = { role: 'user', content: [] };
        const secretURL = `https://api.telegram.org/file/bot${TOKEN}/photos/a.png`;

        const result = await fileUrlToBase64Message({
            urls: [secretURL],
            type: 'photo',
            params,
            AUDIO_HANDLE_TYPE: 'chat',
            text: '',
        });

        const payload = JSON.stringify(result);
        expect(payload).not.toContain(TOKEN);
        expect(payload).not.toContain('/file/bot');
        expect(payload).toContain('iVBORw0KGgo');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
