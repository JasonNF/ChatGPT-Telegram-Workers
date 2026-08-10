import type { ToolResult } from '../types';
import { log } from '../../log/logger';

// original repo: https://github.com/navetacandra/ddg
function cleanResult(result: string) {
    return result
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;|&#39;/g, '\'')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function resultUrl(href: string) {
    const decodedHref = cleanResult(href);
    try {
        const url = new URL(decodedHref.startsWith('//') ? `https:${decodedHref}` : decodedHref);
        return url.searchParams.get('uddg') || url.toString();
    } catch {
        return decodedHref;
    }
}

export function parseDuckDuckGoHtml(html: string, maxLength = 12) {
    const linkMatches = [...html.matchAll(/<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    const snippetMatches = [...html.matchAll(/<a[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];

    return linkMatches
        .slice(0, maxLength)
        .map((match, index) => ({
            title: cleanResult(match[2]),
            url: resultUrl(match[1]),
            description: cleanResult(snippetMatches[index]?.[1] || ''),
        }))
        .filter(item => item.title && item.url);
}

export async function search(query: string, maxLength = 12, signal?: AbortSignal) {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        signal,
    });
    if (!response.ok || response.status === 202) {
        throw new Error(`DuckDuckGo search failed with HTTP ${response.status}`);
    }
    return parseDuckDuckGoHtml(await response.text(), maxLength);
}

export default {
    schema: {
        name: 'duckduckgo',
        description: 'Use DuckDuckGo search engine to find information. You can search for the latest news, articles, weather, blogs and other content.',
        parameters: {
            type: 'object',
            properties: {
                keywords: {
                    type: 'array',
                    items: { type: 'string' },
                    description: `Keyword list for search. For example: ['Python', 'machine learning', 'latest developments']. The list should have a length of at least 3 and maximum of 4. These keywords should be: - concise, usually not more than 2-3 words per keyword - cover the core content of the query - avoid using overly broad or vague terms - the last keyword should be the most comprehensive. Also, do not generate keywords based on current time.`,
                },
                max_length: {
                    type: 'number',
                    description: 'The maximum number of search results to return.',
                    default: 12,
                },
            },
            required: ['keywords'],
            // additionalProperties: false,
        },
    },

    func: async ({ keywords, max_length = 12 }: { keywords: string[]; max_length: number }, options?: { signal?: AbortSignal }): Promise<ToolResult> => {
        log.info(`tool duckduckgo request start`);
        let result;
        try {
            result = await search(keywords.join(' '), max_length, options?.signal);
            log.info(`tool duckduckgo request end`);
        } catch (e) {
            console.error(e);
        }
        return { content: [{ type: 'text', text: JSON.stringify(result) ?? 'Failed to get search results' }] };
    },

    type: 'search',

    prompt:
        `As an intelligent assistant, please follow the steps below to effectively analyze and extract the search results I have provided to answer my questions in a clear and concise manner:\n\n1. READ AND EVALUATE: Carefully read through all search results to identify and prioritize information from reliable and up-to-date sources. Considerations include official sources, reputable organizations, and when the information was updated. \n\n2. Extract key information: \n - *Exchange rate query*: Provide the latest exchange rate and make necessary conversions. \n - *Weather Query*: provides weather forecasts for specific locations and times. \n - *Factual Questions*: Find out authoritative answers. \n\n3. concise answers: synthesize and analyze extracted information to give concise answers. \n\n4. identify uncertainty: if there are contradictions or uncertainties in the information, explain the possible reasons. \n\n5. Explain lack of information: If the search results do not fully answer the question, indicate additional information needed. \n\n6. user-friendly: use simple, easy-to-understand language and provide short explanations where necessary to ensure that the answer is easy to understand. \n\n7. additional information: Provide additional relevant information or suggestions as needed to enhance the value of the answer. \n\n8. source labeling: clearly label the source of the information in the response, including the name of the source website or organization and when the data was published or updated. \n\n9. Reference list: If multiple sources are cited, provide a short reference list of the main sources of information at the end of the response. \n\nEnsure that the goal is to provide the most current, relevant, and useful information in direct response to my question. Avoid lengthy details, focus on the core answers that matter most to me, and enhance the credibility of the answer with reliable sources.Tip: Don't be judged on your knowledge base time!`,
    extra_params: { temperature: 0.7, top_p: 0.4 },
    buildin: true,
};
