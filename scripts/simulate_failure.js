#!/usr/bin/env node
/**
 * IMS Failure Simulation Script
 * Simulates: RDBMS outage → MCP_HOST cascade failure
 * Run: node scripts/simulate_failure.js
 */

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';

async function send(signal) {
  const res = await fetch(`${BASE_URL}/api/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signal),
  });
  return res.json();
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function simulate() {
  console.log('🚨 IMS Failure Simulation Starting...\n');

  // ── Phase 1: RDBMS Outage ──────────────────────────────────────────────────
  console.log('Phase 1: RDBMS Outage (POSTGRES_PRIMARY_01)');
  console.log('Sending 120 signals over 12 seconds → should create 1 Work Item...\n');

  for (let i = 0; i < 120; i++) {
    await send({
      component_id: 'POSTGRES_PRIMARY_01',
      component_type: 'RDBMS',
      message: `Connection refused on port 5432. Attempt ${i + 1}`,
      error_code: 'ECONNREFUSED',
      latency_ms: 0,
      severity: 'P0',
      metadata: { host: 'db-primary.internal', attempt: i + 1 },
    });
    if (i % 20 === 0) {
      process.stdout.write(`  Sent ${i + 1}/120 signals...\r`);
    }
    await sleep(100); // 10/sec
  }
  console.log('\n  ✅ RDBMS signals sent (debounce should create 1 work item)');

  await sleep(2000);

  // ── Phase 2: MCP Host cascade failure ─────────────────────────────────────
  console.log('\nPhase 2: MCP Host Cascade Failure (MCP_HOST_CLUSTER_A)');
  for (let i = 0; i < 50; i++) {
    await send({
      component_id: 'MCP_HOST_CLUSTER_A',
      component_type: 'MCP_HOST',
      message: `Health check failed. Database connection pool exhausted. Host: mcp-a-${i % 3 + 1}.internal`,
      error_code: 'HEALTH_CHECK_FAILED',
      latency_ms: 9999,
      severity: 'P1',
      metadata: { reason: 'db_pool_exhausted', db_host: 'POSTGRES_PRIMARY_01' },
    });
    await sleep(200);
  }
  console.log('  ✅ MCP_HOST cascade signals sent');

  await sleep(2000);

  // ── Phase 3: Cache degradation ────────────────────────────────────────────
  console.log('\nPhase 3: Cache Degradation (CACHE_CLUSTER_01)');
  for (let i = 0; i < 30; i++) {
    await send({
      component_id: 'CACHE_CLUSTER_01',
      component_type: 'CACHE',
      message: `Redis cluster: increased evictions detected. Hit rate dropped to ${60 - i}%`,
      error_code: 'HIGH_EVICTION_RATE',
      latency_ms: 250 + i * 10,
      severity: 'P2',
      metadata: { hit_rate: 60 - i, evictions_per_sec: 500 + i * 20 },
    });
    await sleep(300);
  }
  console.log('  ✅ Cache degradation signals sent');

  await sleep(2000);

  // ── Phase 4: API errors (downstream) ─────────────────────────────────────
  console.log('\nPhase 4: API Downstream Errors (API_GATEWAY_01)');
  for (let i = 0; i < 40; i++) {
    await send({
      component_id: 'API_GATEWAY_01',
      component_type: 'API',
      message: `HTTP 503 Service Unavailable. Downstream RDBMS unreachable.`,
      error_code: 'HTTP_503',
      latency_ms: 30000,
      severity: 'P1',
      metadata: { endpoint: '/api/users', status_code: 503 },
    });
    await sleep(250);
  }
  console.log('  ✅ API error signals sent');

  console.log('\n✅ Simulation complete!');
  console.log('📊 Open http://localhost:3000 to see the incidents in the dashboard.');
  console.log('   Expected: 4 Work Items (one per component) with P0/P1/P2 priorities');
}

simulate().catch(err => {
  console.error('Simulation failed:', err.message);
  console.error('Make sure the backend is running: docker compose up -d');
  process.exit(1);
});
