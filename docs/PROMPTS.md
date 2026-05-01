# Design Plan & Prompts Used

This file documents all planning, design decisions, and prompts used to build the IMS.

---

## System Design Decisions

### Why Fastify over Express?
Fastify is 2-3x faster than Express for JSON serialization and has built-in schema validation. For a signal ingestion system targeting 10,000 signals/sec, this matters.

### Why Ring Buffer for backpressure?
A naive `await db.insert(signal)` on every HTTP request would block under DB slowness. A Ring Buffer decouples ingestion from persistence — the HTTP thread always returns in O(1), and a background worker drains the buffer asynchronously.

### Why MongoDB for signals?
Raw signals are schemaless (different components emit different metadata). MongoDB's flexible documents and fast bulk inserts make it ideal for the audit log. Querying is supported via indexes on `component_id` and `received_at`.

### Why PostgreSQL for Work Items?
Work Item state transitions must be ACID-compliant. A RESOLVED→CLOSED transition that fails halfway through must roll back. PostgreSQL's transactions guarantee this. Redis alone cannot.

### Why Redis for the dashboard?
The live feed refreshes frequently. Querying PostgreSQL for all active incidents on every refresh would cause unnecessary load. Redis `HSET` gives O(1) reads for the dashboard state.

### Debounce Design
When a signal arrives, we check Redis for an active debounce window (`debounce:{component_id}`, TTL=10s). If found, we increment the count. If not found, we create a new Work Item in PostgreSQL and start a new window. This ensures 100 signals → 1 Work Item, all linked via `work_item_id` in MongoDB.

---

## Design Pattern Justification

### Strategy Pattern (Alerting)
The assignment says "different component failures require different alert types". The Strategy Pattern is the textbook solution: define an interface (`AlertStrategy`), implement one class per component type, and swap strategies at runtime without if/else chains.

### State Pattern (Work Item Lifecycle)
The assignment says "manage transitions using the right design pattern". The State Pattern (or State Machine) is canonical for lifecycle management. We encode valid transitions in a map and enforce them at the service layer. Invalid transitions (and missing RCA on CLOSED) are rejected with clear error messages.

---

## Prompts Used During Development

```
1. "Design a high-throughput signal ingestion system that can handle 10,000 signals/sec 
    without crashing when the database is slow. Use a ring buffer for backpressure."

2. "Implement the Strategy design pattern for alerting different component types: 
    RDBMS (P0), API (P1/P2 based on latency), CACHE (P2), QUEUE (P1), MCP_HOST (P1), NOSQL (P2)."

3. "Implement a State Machine for Work Item lifecycle: OPEN → INVESTIGATING → RESOLVED → CLOSED. 
    Reject CLOSED transition if RCA object is missing or incomplete."

4. "Build a React dashboard with: live feed sorted by priority, incident detail page 
    showing raw signals from MongoDB, and an RCA form with datetime pickers."

5. "Write unit tests for RCA validation logic and MTTR calculation."

6. "Write a Docker Compose file that orchestrates MongoDB, PostgreSQL, Redis, 
    Node.js backend, and React/Nginx frontend with health checks."
```
