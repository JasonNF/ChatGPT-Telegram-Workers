import { Cache } from '../cache';
import { fetchWithTimeout, readResponseBytesWithLimit } from '../fetch';

const IMAGE_CACHE = new Cache<Blob>();

/** 图片/文件下载超时。慢链路 + 大文件场景给足余量，但必须有上限。 */
const MEDIA_DOWNLOAD_TIMEOUT_MS = 90_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

async function fetchImage(url: string): Promise<Blob> {
    const cache = IMAGE_CACHE.get(url);
    if (cache) {
        return cache;
    }
    return fetchWithTimeout(url, { timeoutMs: MEDIA_DOWNLOAD_TIMEOUT_MS })
        .then(async (resp) => {
            if (!resp.ok) {
                throw new Error(`Image download failed with HTTP ${resp.status}`);
            }
            const bytes = await readResponseBytesWithLimit(resp, MAX_IMAGE_BYTES);
            return new Blob([bytes], { type: resp.headers.get('content-type') || '' });
        })
        .then((blob) => {
            IMAGE_CACHE.set(url, blob);
            return blob;
        });
}

async function blobToBase64(blob: Blob): Promise<string> {
    try {
        const { Buffer } = await import('node:buffer');
        return blob.arrayBuffer().then(buffer => Buffer.from(buffer).toString('base64'));
    } catch {
    // 非原生base64编码速度太慢不适合在workers中使用
    // 在wrangler.toml中添加 Node.js 选项启用nodejs兼容
    // compatibility_flags = [ "nodejs_compat" ]
        return blob
            .arrayBuffer()
            .then(buffer => btoa(String.fromCharCode.apply(null, new Uint8Array(buffer) as unknown as number[])));
    }
}

function getImageFormatFromBase64(base64String: string): string {
    const firstChar = base64String.charAt(0);
    switch (firstChar) {
        case '/':
            return 'jpeg';
        case 'i':
            return 'png';
        case 'R':
            return 'gif';
        case 'U':
            return 'webp';
        default:
            throw new Error('Unsupported image format');
    }
}

interface Base64DataWithFormat {
    data: string;
    format: string;
}

export async function imageToBase64String(url: string): Promise<Base64DataWithFormat> {
    return blobToBase64String(await fetchImage(url));
}

export async function blobToBase64String(blob: Blob): Promise<Base64DataWithFormat> {
    const base64String = await blobToBase64(blob);
    const contentType = blob.type.split(';', 1)[0].toLowerCase();
    const format = contentType.startsWith('image/')
        ? contentType
        : `image/${getImageFormatFromBase64(base64String)}`;
    return {
        data: base64String,
        format,
    };
}

export function renderBase64DataURI(params: Base64DataWithFormat): string {
    return `data:${params.format};base64,${params.data}`;
}

export async function base64StringToBlob(base64String: string, type: 'image/png' | 'image/jpeg' | 'audio/mp3' | 'audio/oga' = 'image/png'): Promise<Blob> {
    try {
        const { Buffer } = await import('node:buffer');
        const buffer = Buffer.from(base64String, 'base64');
        return new Blob([buffer], { type });
    } catch {
        const uint8Array = Uint8Array.from(atob(base64String), c => c.charCodeAt(0));
        return new Blob([uint8Array], { type });
    }
}
