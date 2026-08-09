import type * as Telegram from 'telegram-bot-api-types';

export interface ThinkingFrame {
    text: string;
    entities?: Telegram.MessageEntity[];
}

export interface ThinkingIndicator {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    isActive: () => boolean;
}

interface ThinkingIndicatorOptions {
    intervalMs: number;
    label: string;
    fallbackEmoji: string;
    customEmojiId?: string;
    includeDots?: boolean;
    sendFrame: (frame: ThinkingFrame) => Promise<void>;
    onError?: (error: unknown, frame: ThinkingFrame) => Promise<void> | void;
}

const DOT_FRAMES = ['.', '..', '...'];

export function buildThinkingFrame(
    frameIndex: number,
    label: string,
    fallbackEmoji: string,
    customEmojiId?: string,
    includeDots = true,
): ThinkingFrame {
    const emoji = fallbackEmoji.trim() || '🔴';
    const name = label.trim() || 'MOSS';
    const text = includeDots
        ? `${emoji} ${name} ${DOT_FRAMES[frameIndex % DOT_FRAMES.length]}`
        : `${emoji} ${name}`;
    const entities = customEmojiId
        ? [{
                type: 'custom_emoji' as const,
                offset: 0,
                // Telegram entity offsets use UTF-16 code units, matching JS string length.
                length: emoji.length,
                custom_emoji_id: customEmojiId,
            }]
        : undefined;

    return { text, entities };
}

export function createThinkingDraftId(messageId: number, now = Date.now()): number {
    const maxDraftId = 2_147_483_646;
    const normalizedMessageId = Math.abs(Math.trunc(messageId)) % maxDraftId;
    const normalizedTime = Math.abs(Math.trunc(now)) % maxDraftId;
    return ((normalizedTime + normalizedMessageId) % maxDraftId) + 1;
}

export function createThinkingIndicator(options: ThinkingIndicatorOptions): ThinkingIndicator {
    let active = false;
    let frameIndex = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> = Promise.resolve();
    const intervalMs = Math.max(400, Math.trunc(options.intervalMs) || 900);

    const runFrame = async () => {
        if (!active) {
            return;
        }

        const frame = buildThinkingFrame(
            frameIndex,
            options.label,
            options.fallbackEmoji,
            options.customEmojiId,
            options.includeDots,
        );
        frameIndex = (frameIndex + 1) % DOT_FRAMES.length;

        try {
            await options.sendFrame(frame);
        } catch (error) {
            active = false;
            await options.onError?.(error, frame);
            return;
        }

        if (active) {
            timer = setTimeout(() => {
                inFlight = runFrame();
            }, intervalMs);
        }
    };

    return {
        start: async () => {
            if (active) {
                return;
            }
            active = true;
            frameIndex = 0;
            inFlight = runFrame();
            await inFlight;
        },
        stop: async () => {
            active = false;
            if (timer) {
                clearTimeout(timer);
                timer = undefined;
            }
            await inFlight.catch(() => undefined);
        },
        isActive: () => active,
    };
}
