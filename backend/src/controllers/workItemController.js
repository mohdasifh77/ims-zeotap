import { pgPool } from '../config/database.js';
import { redis } from '../config/database.js';
import { Signal } from '../models/Signal.js';
import { WorkItemStateMachine } from '../services/WorkItemStateMachine.js';

// GET /api/work-items — list active incidents (from Redis cache first)
export async function listWorkItems(request, reply) {
  try {
    const cached = await redis.hgetall('dashboard:active');
    if (cached && Object.keys(cached).length > 0) {
      const items = Object.values(cached)
        .map(v => JSON.parse(v))
        .sort((a, b) => {
          const pOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
          return (pOrder[a.priority] ?? 9) - (pOrder[b.priority] ?? 9);
        });
      return reply.send({ source: 'cache', data: items });
    }
  } catch (_) {}

  // Fallback to PostgreSQL
  const result = await pgPool.query(`
    SELECT id, component_id, priority, status, title, signal_count, start_time, end_time, mttr_seconds, updated_at
    FROM work_items
    WHERE status != 'CLOSED'
    ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, start_time ASC
  `);
  return reply.send({ source: 'db', data: result.rows });
}

// GET /api/work-items/all — includes closed incidents
export async function listAllWorkItems(request, reply) {
  const result = await pgPool.query(`
    SELECT w.id, w.component_id, w.priority, w.status, w.title, w.signal_count,
           w.start_time, w.end_time, w.mttr_seconds, w.updated_at,
           r.root_cause_category, r.fix_applied, r.prevention_steps, r.incident_start, r.incident_end
    FROM work_items w
    LEFT JOIN rca_records r ON r.work_item_id = w.id
    ORDER BY w.start_time DESC
    LIMIT 200
  `);
  return reply.send({ data: result.rows });
}

// GET /api/work-items/:id — full detail with raw signals
export async function getWorkItem(request, reply) {
  const { id } = request.params;

  const wiResult = await pgPool.query(
    `SELECT w.*, r.root_cause_category, r.fix_applied, r.prevention_steps, r.incident_start, r.incident_end, r.submitted_at as rca_submitted_at
     FROM work_items w
     LEFT JOIN rca_records r ON r.work_item_id = w.id
     WHERE w.id = $1`,
    [id]
  );

  if (wiResult.rows.length === 0) {
    return reply.code(404).send({ error: 'Work item not found' });
  }

  const workItem = wiResult.rows[0];

  // Fetch raw signals from MongoDB
  const signals = await Signal.find({ work_item_id: id })
    .sort({ received_at: -1 })
    .limit(200)
    .lean();

  // Fetch state history
  const transitions = await pgPool.query(
    'SELECT * FROM state_transitions WHERE work_item_id = $1 ORDER BY transitioned_at ASC',
    [id]
  );

  return reply.send({
    work_item: workItem,
    signals,
    state_history: transitions.rows,
  });
}

// PATCH /api/work-items/:id/status — state transition
export async function updateWorkItemStatus(request, reply) {
  const { id } = request.params;
  const { status: targetStatus, reason } = request.body;

  // Load current work item
  const wiResult = await pgPool.query('SELECT * FROM work_items WHERE id = $1', [id]);
  if (wiResult.rows.length === 0) {
    return reply.code(404).send({ error: 'Work item not found' });
  }
  const workItem = wiResult.rows[0];

  // Load RCA if exists
  const rcaResult = await pgPool.query('SELECT * FROM rca_records WHERE work_item_id = $1', [id]);
  const rca = rcaResult.rows[0] || null;

  // Validate transition using State Machine
  const validation = WorkItemStateMachine.validate(workItem.status, targetStatus, rca);
  if (!validation.valid) {
    return reply.code(422).send({ error: validation.error });
  }

  // Execute transition (transactional)
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    const updates = { status: targetStatus };
    let mttr = null;

    if (targetStatus === 'CLOSED') {
      updates.end_time = new Date();
      mttr = WorkItemStateMachine.calcMTTR(workItem.start_time, updates.end_time);
      updates.mttr_seconds = mttr;
    }

    await client.query(
      `UPDATE work_items SET status = $1, end_time = $2, mttr_seconds = $3, updated_at = NOW() WHERE id = $4`,
      [targetStatus, updates.end_time || null, updates.mttr_seconds || null, id]
    );

    await client.query(
      `INSERT INTO state_transitions (work_item_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4)`,
      [id, workItem.status, targetStatus, reason || null]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return reply.code(500).send({ error: 'State transition failed: ' + err.message });
  } finally {
    client.release();
  }

  // Update Redis cache
  try {
    if (targetStatus === 'CLOSED') {
      await redis.hdel('dashboard:active', id);
    } else {
      const cached = await redis.hget('dashboard:active', id);
      if (cached) {
        const entry = JSON.parse(cached);
        entry.status = targetStatus;
        entry.updated_at = new Date().toISOString();
        await redis.hset('dashboard:active', id, JSON.stringify(entry));
      }
    }
  } catch (_) {}

  return reply.send({ success: true, status: targetStatus });
}

// POST /api/work-items/:id/rca — submit RCA
export async function submitRCA(request, reply) {
  const { id } = request.params;
  const { root_cause_category, fix_applied, prevention_steps, incident_start, incident_end } = request.body;

  // Validate completeness
  const validation = WorkItemStateMachine.validate('RESOLVED', 'CLOSED', {
    root_cause_category, fix_applied, prevention_steps, incident_start, incident_end
  });
  if (!validation.valid) {
    return reply.code(422).send({ error: validation.error });
  }

  // Upsert RCA record
  try {
    await pgPool.query(
      `INSERT INTO rca_records (work_item_id, incident_start, incident_end, root_cause_category, fix_applied, prevention_steps)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (work_item_id) DO UPDATE SET
         incident_start = EXCLUDED.incident_start,
         incident_end = EXCLUDED.incident_end,
         root_cause_category = EXCLUDED.root_cause_category,
         fix_applied = EXCLUDED.fix_applied,
         prevention_steps = EXCLUDED.prevention_steps,
         submitted_at = NOW()`,
      [id, incident_start, incident_end, root_cause_category, fix_applied, prevention_steps]
    );
  } catch (err) {
    return reply.code(500).send({ error: 'RCA save failed: ' + err.message });
  }

  return reply.send({ success: true, message: 'RCA submitted. You may now close the incident.' });
}
