import { describe, expect, it } from 'vitest';
import { KeyedSerialQueue, withSerialWrites } from './serial';

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('keyedSerialQueue', () => {
    it('同一 key 的任务串行执行，不会交叠', async () => {
        const queue = new KeyedSerialQueue();
        const events: string[] = [];

        const task = (name: string, ms: number) => async () => {
            events.push(`${name}:start`);
            await delay(ms);
            events.push(`${name}:end`);
        };

        // 故意让先入队的任务更慢，若无串行则 B 会插在 A 中间
        await Promise.all([
            queue.run('chat-1', task('A', 30)),
            queue.run('chat-1', task('B', 1)),
        ]);

        expect(events).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
    });

    it('不同 key 之间保持并发，不损失多用户吞吐', async () => {
        const queue = new KeyedSerialQueue();
        const events: string[] = [];

        const task = (name: string, ms: number) => async () => {
            events.push(`${name}:start`);
            await delay(ms);
            events.push(`${name}:end`);
        };

        await Promise.all([
            queue.run('chat-1', task('A', 30)),
            queue.run('chat-2', task('B', 1)),
        ]);

        // B 属于另一个会话，应在 A 结束前就跑完
        expect(events.indexOf('B:end')).toBeLessThan(events.indexOf('A:end'));
    });

    it('复现并修正「读改写」丢数据：串行后计数不丢', async () => {
        const queue = new KeyedSerialQueue();
        let store = 0;

        // 模拟 get -> 修改 -> put，中间有 await 让出事件循环
        const readModifyWrite = async () => {
            const current = store;
            await delay(5);
            store = current + 1;
        };

        // 无串行时结果为 1（后写覆盖前写）
        store = 0;
        await Promise.all([readModifyWrite(), readModifyWrite()]);
        expect(store).toBe(1);

        // 串行后两次写入都生效
        store = 0;
        await Promise.all([
            queue.run('same', readModifyWrite),
            queue.run('same', readModifyWrite),
        ]);
        expect(store).toBe(2);
    });

    it('前序任务抛错不会阻断后续任务', async () => {
        const queue = new KeyedSerialQueue();
        const failing = queue.run('k', async () => {
            throw new Error('boom');
        });
        await expect(failing).rejects.toThrow('boom');

        await expect(queue.run('k', async () => 'ok')).resolves.toBe('ok');
    });

    it('任务排空后清理 key，避免内存泄漏', async () => {
        const queue = new KeyedSerialQueue();
        await queue.run('temp', async () => delay(1));
        // 等待清理回调执行
        await delay(5);
        expect(queue.pendingKeys).toBe(0);
    });
});

describe('withSerialWrites', () => {
    it('串行化同一 key 的写入，防止并发落盘撕裂', async () => {
        const events: string[] = [];
        const raw = {
            get: async () => null,
            put: async (key: string, value: string) => {
                events.push(`put:${value}:start`);
                await delay(value === 'slow' ? 20 : 1);
                events.push(`put:${value}:end`);
            },
            delete: async () => {},
            list: async () => ({ keys: [] }),
        } as any;

        const db = withSerialWrites(raw);
        await Promise.all([
            db.put('history', 'slow'),
            db.put('history', 'fast'),
        ]);

        expect(events).toEqual([
            'put:slow:start',
            'put:slow:end',
            'put:fast:start',
            'put:fast:end',
        ]);
    });

    it('读操作不排队，不影响读取性能', async () => {
        let getCalls = 0;
        const raw = {
            get: async () => {
                getCalls++;
                return 'v';
            },
            put: async () => {},
            delete: async () => {},
            list: async () => ({ keys: [] }),
        } as any;

        const db = withSerialWrites(raw);
        await Promise.all([db.get('a'), db.get('b'), db.get('c')]);
        expect(getCalls).toBe(3);
    });
});
