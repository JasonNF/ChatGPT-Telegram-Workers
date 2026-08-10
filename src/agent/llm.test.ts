import { describe, expect, it } from 'vitest';
import { appendOAILikeRelayTools } from './llm';

describe('openAI-like relay tools', () => {
    it('appends native relay tools without replacing ordinary tools', () => {
        const ordinaryTool = {
            type: 'function',
            function: { name: 'duckduckgo' },
        };
        const options = { tools: [ordinaryTool] };

        appendOAILikeRelayTools(
            options,
            'gpt-5.6-terra',
            {
                'gemini': ['googleSearch', 'codeExecution'],
                'gpt-5.6-terra': ['googleSearch'],
            },
            ['googleSearch'],
        );

        expect(options.tools).toEqual([
            ordinaryTool,
            { googleSearch: {} },
        ]);
    });

    it('does nothing when the current model has no relay mapping', () => {
        const options = { tools: [{ type: 'function', function: { name: 'image_gen' } }] };

        appendOAILikeRelayTools(
            options,
            'gpt-5.6-terra',
            { gemini: ['googleSearch'] },
            ['googleSearch'],
        );

        expect(options.tools).toEqual([
            { type: 'function', function: { name: 'image_gen' } },
        ]);
    });
});
