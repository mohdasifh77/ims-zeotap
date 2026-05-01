import { Signal } from '../models/Signal.js';
import { AlertingContext } from './AlertingStrategy.js';
import { pgPool } from '../config/database.js';
import { redis } from '../config/database.js';
import { signalBuffer, incrementMetrics } from '../utils/RingBuffer.js';

const DEBOUNCE_WINDOW_MS = 10_000; // 10 seconds
const DEBOUNCE_THRESHOLD = 100;    // 100 signals → 1 work item
const PROCESS_INTERVAL_MS = 200;   // drain buffer every 200ms
const BATCH_SIZE = 500;

// ── Debounce map (in-memory fast path, Redis for persistence) ─────────────────
// Key: component_id, Value: { workItemId, count, firstSignalId }
const debounceMap = new Map();

export function enqueueSignal(signalData) {
  signalBuffer.push(signalData);
  incrementMetrics();
}

// ── Background processor ──────────────────────────────────────────────────────
export function startProcessor() {
  setInterval(async () => {
    const batch = signalBuffer.drain(BATCH_SIZE);
    if (batch.length === 0) return;

    // 1. Bulk-save raw signals to MongoDB (audit log)
    let savedSignals = [];
    try {
      savedSignals = await Signal.insertMany(batch, { ordered: false });
    } catch (err) {
      console.error('MongoDB bulk insert error:', err.message);
      return;
    }

    // 2. Process each signal for debounce + work item creation
    for (const sig of savedSignals) {
      await processSignalForWorkItem(sig);
    }
  }, PROCESS_INTERVAL_MS);
}

async function processSignalForWorkItem(signal) {
  const compId = signal.component_id;
  const now = Date.now();

  // Check Redis for active debounce window
  const redisKey = `debounce:${compId}`;
  let debounceData = null;

  try {
    const raw = await redis.get(redisKey);
    if (raw) debounceData = JSON.parse(raw);
  } catch (_) {}

  if (debounceData) {
    // Existing debounce window — just increment count and link signal
    debounceData.count++;
    await Signal.findByIdAndUpdate(signal._id, { work_item_id: debounceData.workItemId });

    // Update work item signal count in postgres
    if (debounceData.count % 10 === 0) {
      await pgPool.query(
        'UPDATE work_items SET signal_count = $1, updated_at = NOW() WHERE id = $2',
        [debounceData.count, debounceData.workItemId]
      );
    }
    // Refresh TTL
    await redis.set(redisKey, JSON.stringify(debounceData), 'PX', DEBOUNCE_WINDOW_MS);
  } else {
    // New debounce window — create a Work Item
    const alert = AlertingContext.getAlert(signal);

    let workItemId;
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(
        `INSERT INTO work_items (component_id, priority, status, title, signal_count, start_time)
         VALUES ($1, $2, 'OPEN', $3, 1, NOW())
         RETURNING id`,
        [compId, alert.priority, alert.title]
      );
      workItemId = res.rows[0].id;

      await client.query(
        `INSERT INTO state_transitions (work_item_id, from_status, to_status, reason)
         VALUES ($1, NULL, 'OPEN', 'Work item created from signal ingestion')`,
        [workItemId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Work item creation error:', err.message);
      return;
    } finally {
      client.release();
    }

    // Link signal to work item
    await Signal.findByIdAndUpdate(signal._id, { work_item_id: workItemId });

    // Store in debounce map and Redis
    const newDebounce = { workItemId, count: 1, componentId: compId };
    await redis.set(redisKey, JSON.stringify(newDebounce), 'PX', DEBOUNCE_WINDOW_MS);

    // Update Redis dashboard cache
    await updateDashboardCache(workItemId, alert, compId);

    console.log(`🆕 Work Item created: ${workItemId} | Component: ${compId} | Priority: ${alert.priority}`);
  }
}

// ── Redis dashboard cache update ──────────────────────────────────────────────
async function updateDashboardCache(workItemId, alert, componentId) {
  const cacheEntry = {
    id: workItemId,
    component_id: componentId,
    priority: alert.priority,
    title: alert.title,
    status: 'OPEN',
    signal_count: 1,
    start_time: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await redis.hset('dashboard:active', workItemId, JSON.stringify(cacheEntry));
}

export async function refreshDashboardCache() {
  const result = await pgPool.query(`
    SELECT id, component_id, priority, status, title, signal_count, start_time, updated_at
    FROM work_items
    WHERE status != 'CLOSED'
    ORDER BY 
      CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      start_time ASC
    LIMIT 100
  `);

  // Clear and rebuild
  await redis.del('dashboard:active');
  if (result.rows.length > 0) {
    const entries = {};
    result.rows.forEach(row => {
      entries[row.id] = JSON.stringify(row);
    });
    await redis.hset('dashboard:active', entries);
  }
}
