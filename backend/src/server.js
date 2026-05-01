import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { connectMongo, connectPostgres, connectRedis, redis } from './config/database.js';
import { startProcessor, refreshDashboardCache } from './services/SignalProcessor.js';
import { ingestSignal, ingestBulkSignals } from './controllers/signalController.js';
import {
  listWorkItems, listAllWorkItems, getWorkItem,
  updateWorkItemStatus, submitRCA
} from './controllers/workItemController.js';
import { getAndResetWindowMetrics, getTotalIngested, signalBuffer } from './utils/RingBuffer.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

const fastify = Fastify({
  logger: { level: 'warn' },
  trustProxy: true,
});

// ── Plugins ───────────────────────────────────────────────────────────────────
await fastify.register(cors, { origin: '*', methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] });

await fastify.register(rateLimit, {
  global: false,
  max: parseInt(process.env.RATE_LIMIT_MAX || '10000', 10),
  timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '1000', 10),
});

await fastify.register(websocket);

// ── Health endpoint ───────────────────────────────────────────────────────────
fastify.get('/health', async (request, reply) => {
  let mongoOk = false, pgOk = false, redisOk = false;
  try { await import('./models/Signal.js').then(m => m.Signal.db.db.command({ ping: 1 })); mongoOk = true; } catch (_) {}
  try { const c = await (await import('./config/database.js')).pgPool.connect(); c.release(); pgOk = true; } catch (_) {}
  try { await redis.ping(); redisOk = true; } catch (_) {}

  const allOk = mongoOk && pgOk && redisOk;
  return reply.code(allOk ? 200 : 503).send({
    status: allOk ? 'healthy' : 'degraded',
    components: { mongodb: mongoOk, postgresql: pgOk, redis: redisOk },
    buffer_size: signalBuffer.length,
    total_ingested: getTotalIngested(),
    timestamp: new Date().toISOString(),
  });
});

// ── Signal Ingestion (rate-limited) ──────────────────────────────────────────
fastify.post('/api/signals', { config: { rateLimit: { max: 10000, timeWindow: 1000 } } }, ingestSignal);
fastify.post('/api/signals/bulk', { config: { rateLimit: { max: 100, timeWindow: 1000 } } }, ingestBulkSignals);

// ── Work Items API ────────────────────────────────────────────────────────────
fastify.get('/api/work-items', listWorkItems);
fastify.get('/api/work-items/all', listAllWorkItems);
fastify.get('/api/work-items/:id', getWorkItem);
fastify.patch('/api/work-items/:id/status', updateWorkItemStatus);
fastify.post('/api/work-items/:id/rca', submitRCA);

// ── WebSocket: live dashboard updates ────────────────────────────────────────
const wsClients = new Set();

fastify.get('/ws', { websocket: true }, (socket) => {
  wsClients.add(socket);
  socket.on('close', () => wsClients.delete(socket));
});

export function broadcastToClients(data) {
  const payload = JSON.stringify(data);
  for (const client of wsClients) {
    try { client.send(payload); } catch (_) {}
  }
}

// ── Throughput metrics every 5 seconds ───────────────────────────────────────
setInterval(() => {
  const signals = getAndResetWindowMetrics();
  const rate = (signals / 5).toFixed(1);
  console.log(`📊 Throughput: ${rate} signals/sec | Buffer: ${signalBuffer.length} | Total: ${getTotalIngested()}`);
  broadcastToClients({ type: 'metrics', rate: parseFloat(rate), buffer: signalBuffer.length, total: getTotalIngested() });
}, 5000);

// ── Refresh dashboard cache every 30 seconds ─────────────────────────────────
setInterval(() => refreshDashboardCache().catch(console.error), 30_000);

// ── Boot ──────────────────────────────────────────────────────────────────────
async function start() {
  console.log('🚀 Connecting to databases...');
  
  // Retry logic for DB connections
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await connectMongo();
      await connectPostgres();
      await connectRedis();
      break;
    } catch (err) {
      if (attempt === 5) throw err;
      console.log(`⚠️  DB connection attempt ${attempt} failed. Retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  startProcessor();

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`✅ IMS Backend running on http://0.0.0.0:${PORT}`);
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
