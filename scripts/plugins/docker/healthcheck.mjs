import fs from 'node:fs';
import net from 'node:net';

const configPath = process.env.CONFIG_PATH || '/app/config.json';
const heartbeatPath = process.env.HEARTBEAT_PATH || '/tmp/tg-bot-heartbeat';
const heartbeatMaxAgeMs = Number(process.env.HEARTBEAT_MAX_AGE_MS || 120_000);

function fail(message) {
    console.error(message);
    process.exit(1);
}

let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch {
    fail('healthcheck: unable to read config');
}

if (config.mode === 'polling') {
    try {
        const heartbeat = Number(fs.readFileSync(heartbeatPath, 'utf8'));
        const age = Date.now() - heartbeat;
        if (!Number.isFinite(age) || age < 0 || age > heartbeatMaxAgeMs) {
            fail('healthcheck: polling heartbeat is stale');
        }
        process.exit(0);
    } catch {
        fail('healthcheck: polling heartbeat is missing');
    }
}

const port = Number(config.server?.port || 8787);
const socket = net.createConnection({ host: '127.0.0.1', port });
socket.setTimeout(3000);
socket.once('connect', () => {
    socket.destroy();
    process.exit(0);
});
socket.once('timeout', () => {
    socket.destroy();
    fail('healthcheck: webhook port timed out');
});
socket.once('error', () => fail('healthcheck: webhook port is unavailable'));
