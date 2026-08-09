/**
 * Per-key serial execution queue.
 *
 * 背景：项目中大量存储操作是 `get -> 修改 -> put` 的读改写模式
 * （对话历史、用户配置、媒体消息分组、待删消息表等）。
 * 而 polling 适配器使用 `setImmediate` 并发派发 update，
 * webhook 模式下 Telegram 也会并发投递。
 *
 * 后果：同一会话上两个读改写交叠时，后写入者会覆盖前者的结果，
 * 表现为「快速连发两条消息，其中一条的对话历史静默丢失」，且不抛错。
 *
 * 方案：以「会话」为粒度串行化整个 update 处理流程（见 handleUpdate），
 * 使 `读历史 -> 调用模型 -> 写历史` 成为一个完整临界区。
 * 不同会话之间保持并发，因此不损失多用户吞吐。
 */
export class KeyedSerialQueue {
    private readonly chains = new Map<string, Promise<unknown>>();

    /**
     * 将 task 排入 key 对应的队列尾部，返回 task 的结果。
     * 前序任务失败不会阻断后续任务。
     */
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
        const previous = this.chains.get(key) ?? Promise.resolve();
        // 无论前序成功或失败都继续执行，保证链条不断裂
        const current = previous.then(task, task);
        // 记录一条「永不 reject」的尾巴，避免 unhandled rejection
        const tail = current.then(
            () => undefined,
            () => undefined,
        );
        this.chains.set(key, tail);
        // 队列空转后清理，防止 key 无限增长导致内存泄漏
        tail.then(() => {
            if (this.chains.get(key) === tail) {
                this.chains.delete(key);
            }
        });
        return current;
    }

    /** 当前仍在排队的 key 数量，仅用于调试与测试 */
    get pendingKeys(): number {
        return this.chains.size;
    }
}

/**
 * 全局会话队列：由 handleUpdate 使用，按 chat/用户维度串行。
 */
export const sessionQueue = new KeyedSerialQueue();

/**
 * 兜底保护：把存储层的写操作按 key 串行化。
 *
 * 注意这一层**不能**替代会话级串行 —— 单独串行 put 无法阻止
 * 「A 读 → B 读 → A 写 → B 写」的交叠。它的作用是防止同一 key
 * 上的并发写互相撕裂（例如定时任务与消息处理同时落盘），
 * 属于纵深防御的第二道。
 *
 * 使用泛型透传原始实现的类型，避免与具体适配器（sqlite / redis /
 * local / memory）的额外参数和返回类型冲突。
 */
export function withSerialWrites<T extends {
    put: (key: string, value: any, info?: any) => Promise<any>;
    delete: (key: string, ...args: any[]) => Promise<any>;
}>(db: T): T {
    const queue = new KeyedSerialQueue();
    const originalPut = db.put.bind(db);
    const originalDelete = db.delete.bind(db);

    // 保留原对象（含其余方法与内部状态），仅覆写写操作
    const wrapped = Object.create(
        Object.getPrototypeOf(db),
        Object.getOwnPropertyDescriptors(db),
    ) as T;

    wrapped.put = ((key: string, value: any, info?: any) =>
        queue.run(key, () => originalPut(key, value, info))) as T['put'];
    wrapped.delete = ((key: string, ...args: any[]) =>
        queue.run(key, () => originalDelete(key, ...args))) as T['delete'];

    return wrapped;
}
