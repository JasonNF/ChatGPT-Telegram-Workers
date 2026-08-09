import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENV } from '../../config/env';
import { ResponseBodyTooLargeError } from '../../utils/fetch';
import { downloadTelegramFiles, getTelegramFile } from './tg_utils';

const { getFileWithReturns } = vi.hoisted(() => ({
    getFileWithReturns: vi.fn(),
}));

vi.mock('../api', () => ({
    createTelegramBotAPI: () => ({ getFileWithReturns }),
}));

const TOKEN = '123456:telegram-secret';
const defaults = {
    count: ENV.TELEGRAM_MAX_FILE_COUNT,
    fileSize: ENV.TELEGRAM_MAX_FILE_SIZE,
    totalSize: ENV.TELEGRAM_MAX_TOTAL_FILE_SIZE,
};

afterEach(() => {
    ENV.TELEGRAM_MAX_FILE_COUNT = defaults.count;
    ENV.TELEGRAM_MAX_FILE_SIZE = defaults.fileSize;
    ENV.TELEGRAM_MAX_TOTAL_FILE_SIZE = defaults.totalSize;
    getFileWithReturns.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('getTelegramFile', () => {
    it('日志不记录包含 Bot Token 的文件 URL', async () => {
        getFileWithReturns.mockResolvedValue({ ok: true, result: { file_path: 'photos/a.png' } });
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

        const urls = await getTelegramFile(['file-id'], TOKEN, 'url') as string[];

        expect(urls[0]).toContain(`/file/bot${TOKEN}/`);
        const logs = info.mock.calls.flat().join('\n');
        expect(logs).not.toContain(TOKEN);
        expect(logs).not.toContain('/file/bot');
    });

    it('在调用 Telegram API 前拒绝超量文件', async () => {
        ENV.TELEGRAM_MAX_FILE_COUNT = 1;
        await expect(getTelegramFile(['one', 'two'], TOKEN)).rejects.toThrow('maximum 1');
        expect(getFileWithReturns).not.toHaveBeenCalled();
    });
});

describe('downloadTelegramFiles', () => {
    it('读取响应体前执行单文件大小限制，错误不泄露 URL', async () => {
        ENV.TELEGRAM_MAX_FILE_SIZE = 4;
        vi.stubGlobal('fetch', vi.fn(async () => new Response('12345', {
            headers: { 'content-length': '5' },
        })));
        const secretURL = `https://api.telegram.org/file/bot${TOKEN}/document.txt`;

        const error = await downloadTelegramFiles([secretURL]).catch(value => value);
        expect(error).toBeInstanceOf(ResponseBodyTooLargeError);
        expect(String(error)).not.toContain(TOKEN);
    });

    it('对分块响应执行整条消息总大小限制', async () => {
        ENV.TELEGRAM_MAX_FILE_SIZE = 10;
        ENV.TELEGRAM_MAX_TOTAL_FILE_SIZE = 6;
        vi.stubGlobal('fetch', vi.fn(async () => new Response('1234')));

        await expect(downloadTelegramFiles(['https://example.test/a', 'https://example.test/b']))
            .rejects
            .toThrow('total limit');
    });
});
