import type { AgentUserConfig } from '../config/env';
import type { LogStruct } from './log_decortor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLog, getLog, logSingleton } from './log_decortor';

const configs: AgentUserConfig[] = [];

afterEach(() => {
    vi.useRealTimers();
    configs.forEach(clearLog);
    configs.length = 0;
});

describe('compact Telegram log footer', () => {
    it('renders model latency and token usage as two compact code lines', () => {
        const config = {
            ENABLE_SHOWINFO: true,
            SHOW_PARTS: ['model', 'model_time', 'first_chunk_time', 'token'],
        } as AgentUserConfig;
        configs.push(config);
        logSingleton.set(config, [{
            model: 'gpt-5.6-terra',
            functions: [],
            start_time: 1_000,
            end_time: 15_000,
            first_chunk_time: 14_000,
            tokens: {
                prompt: 7_250,
                completion: 216,
                cached: 6_500,
                reasoning: 40,
            },
        }]);

        expect(getLog(config)).toBe([
            '`gpt-5.6-terra 14.0s ttfc 14.0s`',
            '`↑ 7.3k (cache 6.5k 89.7%) · ↓ 216 (think 40)`',
        ].join('\n'));
    });

    it('adds timing and token fields as the native stream lifecycle advances', () => {
        vi.useFakeTimers();
        const config = {
            ENABLE_SHOWINFO: true,
            SHOW_PARTS: ['model', 'model_time', 'first_chunk_time', 'token'],
        } as AgentUserConfig;
        configs.push(config);
        const record: LogStruct = {
            model: 'gpt-5.6-terra',
            functions: [],
            start_time: 1_000,
            end_time: undefined,
            first_chunk_time: null,
        };
        logSingleton.set(config, [record]);

        vi.setSystemTime(2_000);
        expect(getLog(config)).toBe('`gpt-5.6-terra 1.0s`');

        record.first_chunk_time = 600;
        vi.setSystemTime(2_500);
        expect(getLog(config)).toBe('`gpt-5.6-terra 1.5s ttfc 0.6s`');

        Object.assign(record, {
            end_time: 3_000,
            tokens: { prompt: 120, completion: 30 },
        });
        expect(getLog(config)).toBe([
            '`gpt-5.6-terra 2.0s ttfc 0.6s`',
            '`↑ 120 · ↓ 30`',
        ].join('\n'));
    });

    it('aggregates multi-step usage and keeps explicit zero cache and reasoning values', () => {
        const config = {
            ENABLE_SHOWINFO: true,
            SHOW_PARTS: ['model', 'model_time', 'first_chunk_time', 'token'],
        } as AgentUserConfig;
        configs.push(config);
        logSingleton.set(config, [
            {
                model: 'first-model',
                functions: [],
                start_time: 1_000,
                end_time: 2_000,
                first_chunk_time: 500,
                tokens: { prompt: 1_000, completion: 20 },
            },
            {
                model: 'final-model',
                functions: [],
                start_time: 2_500,
                end_time: 4_000,
                first_chunk_time: 250,
                tokens: { prompt: 500, completion: 10, cached: 0, reasoning: 0 },
            },
        ]);

        expect(getLog(config)).toBe([
            '`first-model 1.0s ttfc 0.5s`',
            '`final-model 1.5s ttfc 0.3s`',
            '`↑ 1.5k (cache 0 0.0%) · ↓ 30 (think 0)`',
        ].join('\n'));
    });
});
