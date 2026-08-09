import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    buildThinkingFrame,
    createThinkingDraftId,
    createThinkingIndicator,
} from './thinking';

afterEach(() => {
    vi.useRealTimers();
});

describe('buildThinkingFrame', () => {
    it('cycles through one, two, and three dots', () => {
        expect(buildThinkingFrame(0, 'MOSS', '🔴').text).toBe('🔴 MOSS .');
        expect(buildThinkingFrame(1, 'MOSS', '🔴').text).toBe('🔴 MOSS ..');
        expect(buildThinkingFrame(2, 'MOSS', '🔴').text).toBe('🔴 MOSS ...');
        expect(buildThinkingFrame(3, 'MOSS', '🔴').text).toBe('🔴 MOSS .');
    });

    it('uses UTF-16 length for a custom emoji entity', () => {
        expect(buildThinkingFrame(0, 'MOSS', '🔴', 'custom-id')).toMatchObject({
            entities: [{
                type: 'custom_emoji',
                offset: 0,
                length: 2,
                custom_emoji_id: 'custom-id',
            }],
        });
    });
});

it('creates a stable non-zero Telegram draft id', () => {
    expect(createThinkingDraftId(42, 1_000)).toBe(1_043);
    expect(createThinkingDraftId(42, 1_000)).toBe(createThinkingDraftId(42, 1_000));
    expect(createThinkingDraftId(-42, -1_000)).toBeGreaterThan(0);
});

it('animates until stopped without overlapping timers', async () => {
    vi.useFakeTimers();
    const frames: string[] = [];
    const indicator = createThinkingIndicator({
        intervalMs: 900,
        label: 'MOSS',
        fallbackEmoji: '🔴',
        sendFrame: async (frame) => {
            frames.push(frame.text);
        },
    });

    await indicator.start();
    expect(frames).toEqual(['🔴 MOSS .']);

    await vi.advanceTimersByTimeAsync(1_800);
    expect(frames).toEqual(['🔴 MOSS .', '🔴 MOSS ..', '🔴 MOSS ...']);

    await indicator.stop();
    await vi.advanceTimersByTimeAsync(1_800);
    expect(frames).toHaveLength(3);
    expect(indicator.isActive()).toBe(false);
});

it('stops and falls back when a draft update fails', async () => {
    const fallback = vi.fn(async () => undefined);
    const indicator = createThinkingIndicator({
        intervalMs: 900,
        label: 'MOSS',
        fallbackEmoji: '🔴',
        sendFrame: async () => {
            throw new Error('draft unavailable');
        },
        onError: fallback,
    });

    await indicator.start();
    expect(fallback).toHaveBeenCalledOnce();
    expect(indicator.isActive()).toBe(false);
});
