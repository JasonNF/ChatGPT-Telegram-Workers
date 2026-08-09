import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';

const TOOL_PATH = process.env.TOOL_PATH || '/app/tool';

/**
 * 是否允许执行 TOOL_PATH 下的脚本工具（.js / .ts）。
 *
 * 安全背景：脚本工具是通过 `import()` 动态加载并执行的，等价于
 * 在 bot 进程内执行任意代码 —— 可读取全部环境变量（含所有 API Key
 * 与 Bot Token）、发起任意网络请求、读写容器文件系统。
 *
 * 原实现只要目录存在就无条件加载全部脚本，一旦挂载目录可写、
 * 或镜像被塞入额外文件，即构成完整的代码执行链。
 *
 * 现改为**显式选择加入**：必须设置 ENABLE_LOCAL_TOOL_SCRIPTS=true
 * 才会执行脚本。声明式的 .json 工具不含可执行代码，不受此开关限制。
 */
const ENABLE_LOCAL_TOOL_SCRIPTS = ['true', '1', 'yes'].includes(
    (process.env.ENABLE_LOCAL_TOOL_SCRIPTS || '').trim().toLowerCase(),
);

async function readToolFiles(files: string[]) {
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    const scriptFiles = files.filter(file => file.endsWith('.js') || file.endsWith('.ts'));
    const tools: Record<string, any> = {};

    await Promise.all(jsonFiles.map(async (file) => {
        const toolName = file.replace(/\.json$/, '');
        const content = await fs.readFile(resolve(TOOL_PATH, file), 'utf8');
        try {
            tools[toolName] = JSON.parse(content);
        } catch (error) {
            console.error(error);
        }
    }));

    if (scriptFiles.length > 0 && !ENABLE_LOCAL_TOOL_SCRIPTS) {
        console.warn(
            `[security] skipped ${scriptFiles.length} local script tool(s) in ${TOOL_PATH}: `
            + `${scriptFiles.join(', ')}. Set ENABLE_LOCAL_TOOL_SCRIPTS=true to allow executing them.`,
        );
        return tools;
    }

    await Promise.all(scriptFiles.map(async (file) => {
        const toolName = file.replace(/\.[j|t]s$/, '');
        try {
            const { default: tool } = await import(resolve(TOOL_PATH, file));
            tools[toolName] = tool;
        } catch (error) {
            console.error(error);
        }
    }));
    return tools;
}

export async function getLocalTools() {
    if (existsSync(TOOL_PATH)) {
        const files = await fs.readdir(TOOL_PATH);
        return readToolFiles(files);
    }
    return {};
}
