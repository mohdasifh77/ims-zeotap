import { enqueueSignal } from '../services/SignalProcessor.js';

const ALLOWED_COMPONENT_TYPES = ['API', 'MCP_HOST', 'CACHE', 'QUEUE', 'RDBMS', 'NOSQL'];

export async function ingestSignal(request, reply) {
  const body = request.body;

  // Validate required fields
  if (!body.component_id || !body.component_type || !body.message) {
    return reply.code(400).send({ error: 'Missing required fields: component_id, component_type, message' });
  }

  if (!ALLOWED_COMPONENT_TYPES.includes(body.component_type)) {
    return reply.code(400).send({
      error: `Invalid component_type. Must be one of: ${ALLOWED_COMPONENT_TYPES.join(', ')}`
    });
  }

  // Enqueue to in-memory buffer (non-blocking — returns immediately)
  enqueueSignal({
    component_id: body.component_id,
    component_type: body.component_type,
    message: body.message,
    error_code: body.error_code || null,
    latency_ms: body.latency_ms || 0,
    severity: body.severity || 'P2',
    metadata: body.metadata || {},
    received_at: new Date(),
  });

  return reply.code(202).send({ status: 'accepted', message: 'Signal queued for processing' });
}

// Bulk ingestion endpoint for high-throughput testing
export async function ingestBulkSignals(request, reply) {
  const { signals } = request.body;

  if (!Array.isArray(signals) || signals.length === 0) {
    return reply.code(400).send({ error: 'signals must be a non-empty array' });
  }

  if (signals.length > 1000) {
    return reply.code(400).send({ error: 'Max 1000 signals per bulk request' });
  }

  let queued = 0;
  for (const sig of signals) {
    if (sig.component_id && sig.component_type && sig.message) {
      enqueueSignal({ ...sig, received_at: new Date() });
      queued++;
    }
  }

  return reply.code(202).send({ status: 'accepted', queued });
}
