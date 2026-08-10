import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDuckDuckGoHtml, search } from './duckduckgo';

const html = `
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnews%3Fx%3D1%26y%3D2&amp;rut=abc"><b>Example</b> &amp; News</a>
  <a class="result__snippet" href="//duckduckgo.com/l/">Latest <b>verified</b> item.</a>
</div>
<div class="result results_links results_links_deep web-result">
  <a rel="nofollow" class="result__a" href="https://openai.com/news/">OpenAI News</a>
  <a class="result__snippet" href="https://openai.com/news/">Official updates.</a>
</div>`;

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('duckDuckGo HTML search', () => {
    it('parses titles, snippets, and redirect URLs', () => {
        expect(parseDuckDuckGoHtml(html)).toEqual([
            {
                title: 'Example & News',
                url: 'https://example.com/news?x=1&y=2',
                description: 'Latest verified item.',
            },
            {
                title: 'OpenAI News',
                url: 'https://openai.com/news/',
                description: 'Official updates.',
            },
        ]);
    });

    it('uses the HTML endpoint with browser headers and honors the result limit', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(html, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(search('OpenAI latest news', 1)).resolves.toEqual([{
            title: 'Example & News',
            url: 'https://example.com/news?x=1&y=2',
            description: 'Latest verified item.',
        }]);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://html.duckduckgo.com/html/?q=OpenAI%20latest%20news',
            expect.objectContaining({
                headers: expect.objectContaining({
                    'User-Agent': expect.stringContaining('Mozilla/5.0'),
                }),
            }),
        );
    });
});
