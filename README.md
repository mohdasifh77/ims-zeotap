# Incident Management System (IMS)

A mission-critical, production-grade Incident Management System built to monitor distributed infrastructure stacks and manage failure mediation workflows.

> **Assignment:** Infrastructure / SRE Intern — Zeotap  
> **GitHub:** *(https://github.com/mohdasifh77/ims)*

---

## Architecture Diagram

```
                        ┌─────────────────────────────────────────────┐
                        │              CLIENT BROWSER                  │
                        │         React SPA (port 3000)               │
                        └───────────────┬─────────────────────────────┘
                                        │ HTTP / WebSocket
                        ┌───────────────▼─────────────────────────────┐
                        │           NGINX (reverse proxy)             │
                        └───────────────┬─────────────────────────────┘
                                        │
                        ┌───────────────▼─────────────────────────────┐
                        │        FASTIFY BACKEND (port 3001)          │
                        │                                             │
                        │  ┌──────────────┐  ┌─────────────────────┐ │
                        │  │ Rate Limiter │  │  WebSocket Server   │ │
                        │  └──────┬───────┘  └─────────────────────┘ │
                        │         │                                   │
                        │  ┌──────▼───────────────────────────────┐  │
                        │  │      In-Memory Ring Buffer            │  │
                        │  │   (50,000 capacity, backpressure)    │  │
                        │  └──────────────────────────────────────┘  │
                        │         │                                   │
                        │  ┌──────▼───────────────────────────────┐  │
                        │  │   Background Processor (200ms tick)  │  │
                        │  │   - Debounce (10s/100 signals)       │  │
                        │  │   - Strategy Pattern (alerts)        │  │
                        │  │   - State Machine (transitions)      │  │
                        │  └──────────────────────────────────────┘  │
                        └──────┬──────────────┬────────────────┬──────┘
                               │              │                │
               ┌───────────────▼──┐  ┌────────▼──────┐  ┌────▼──────────┐
               │   MongoDB        │  │  PostgreSQL   │  │    Redis      │
               │  (Raw signals    │  │  (Work Items  │  │ (Dashboard    │
               │   audit log)     │  │   + RCA)      │  │  cache +      │
               │   NoSQL store    │  │  RDBMS ACID   │  │  debounce)    │
               └──────────────────┘  └───────────────┘  └───────────────┘
```

---

## Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Backend | Node.js + Fastify | High-throughput async I/O, minimal overhead |
| Frontend | React + Vite | Fast SPA development, component reuse |
| NoSQL (Signals) | MongoDB | Schemaless raw signal storage, fast bulk inserts |
| RDBMS (Work Items) | PostgreSQL | ACID transactions for state transitions |
| Cache | Redis | Sub-millisecond dashboard reads, debounce windows |
| Container | Docker + Docker Compose | Reproducible environments |
| Reverse Proxy | Nginx | Static serving + API proxy |

---

## Design Patterns Used

### 1. Strategy Pattern — Alerting
File: `backend/src/services/AlertingStrategy.js`

Each component type (RDBMS, API, CACHE, etc.) has a dedicated `AlertStrategy` subclass. The `AlertingContext` class picks the correct strategy at runtime. This allows swapping alert logic without touching the core processor.

```
AlertStrategy (abstract)
├── RDBMSAlertStrategy  → P0, escalate=true, pagerDuty=true
├── APIAlertStrategy    → P1/P2 based on latency
├── CacheAlertStrategy  → P2
├── QueueAlertStrategy  → P1
├── MCPHostAlertStrategy→ P1
└── NoSQLAlertStrategy  → P2
```

### 2. State Machine Pattern — Work Item Lifecycle
File: `backend/src/services/WorkItemStateMachine.js`

Valid transitions are declared in a transition map. Any invalid jump (e.g., OPEN → CLOSED) is rejected. Closing requires a **complete RCA object** (validated server-side).

```
OPEN → INVESTIGATING → RESOLVED → CLOSED (terminal)
```

---

## How Backpressure is Handled

The signal ingestion endpoint (`POST /api/signals`) is **non-blocking**. It immediately places the signal into an in-memory **Ring Buffer** and returns `HTTP 202 Accepted`.

- **Ring Buffer capacity:** 50,000 signals
- **Overflow policy:** Drop oldest signal (tail) when full — protects memory
- **Background drain:** Every 200ms, up to 500 signals are pulled from the buffer and batch-inserted into MongoDB
- **DB slowness:** If MongoDB is slow, signals accumulate in the ring buffer, not on the HTTP layer — the server never crashes

```
HTTP POST → Ring Buffer (non-blocking, O(1)) → Background Worker → MongoDB
```

Rate limiting (`@fastify/rate-limit`) prevents the buffer from being overwhelmed at the HTTP layer too.

---

## Setup Instructions (Windows — Complete Guide)

### Prerequisites (Install in this order)

**Step 1 — Install Git**
1. Go to: https://git-scm.com/download/win
2. Download and run the installer
3. Accept all defaults → click Next until done
4. Open **Command Prompt** and verify: `git --version`

**Step 2 — Install Docker Desktop**
1. Go to: https://www.docker.com/products/docker-desktop/
2. Click "Download for Windows"
3. Run the installer — accept all defaults
4. **Restart your computer** after installation
5. Open Docker Desktop (from Start menu) and wait for it to say "Engine running"
6. Open **Command Prompt** and verify: `docker --version`

**Step 3 — Install Node.js** (only needed to run simulation script)
1. Go to: https://nodejs.org/
2. Download the LTS version (green button)
3. Run installer — accept all defaults
4. Open **Command Prompt** and verify: `node --version`

---

### Running the Application

**Step 1 — Clone the repository**
```bash
git clone https://github.com/YOUR_USERNAME/ims-zeotap.git
cd ims-zeotap
```

**Step 2 — Start all services**
```bash
docker compose up --build
```
Wait 2-3 minutes for first build. You'll see:
```
✅ MongoDB connected
✅ PostgreSQL connected
✅ Redis connected
✅ IMS Backend running on http://0.0.0.0:3001
```

**Step 3 — Open the dashboard**

Open your browser and go to: **http://localhost:3000**

**Step 4 — Run the failure simulation**
```bash
# In a NEW Command Prompt window (keep docker compose running)
node scripts/simulate_failure.js
```

**Step 5 — Stop the application**
```bash
docker compose down
```
To also delete all data:
```bash
docker compose down -v
```

---

### Testing Individual API Endpoints

Use these commands in Command Prompt (Windows):

**Send a single signal:**
```bash
curl -X POST http://localhost:3001/api/signals ^
  -H "Content-Type: application/json" ^
  -d "{\"component_id\":\"POSTGRES_01\",\"component_type\":\"RDBMS\",\"message\":\"DB down\",\"severity\":\"P0\"}"
```

**Check system health:**
```bash
curl http://localhost:3001/health
```

**List active incidents:**
```bash
curl http://localhost:3001/api/work-items
```

---

### Running Tests

```bash
cd backend
npm install
npm test
```

---

## Functional Features

- ✅ **Signal Ingestion** — Single and bulk endpoints with rate limiting
- ✅ **Debouncing** — 100 signals/10s per component → 1 Work Item
- ✅ **Strategy Pattern** — Per-component-type alerting with correct priorities
- ✅ **State Machine** — Enforced OPEN→INVESTIGATING→RESOLVED→CLOSED lifecycle
- ✅ **Mandatory RCA** — CLOSED transition rejected without complete RCA
- ✅ **MTTR Calculation** — Automatic computation on closure
- ✅ **Live Dashboard** — WebSocket-powered real-time updates
- ✅ **Incident Detail** — Raw MongoDB signals + state history
- ✅ **RCA Form** — Full form with datetime pickers, dropdown, text areas
- ✅ **Redis Cache** — Hot-path dashboard state, avoids DB queries
- ✅ **Ring Buffer** — Handles 10,000 signals/sec without crashing
- ✅ **Health Endpoint** — `/health` with component status
- ✅ **Throughput Metrics** — Console output every 5 seconds
- ✅ **Retry Logic** — DB connection retries on startup (5 attempts)
- ✅ **Transactional writes** — Work Item creation and RCA are fully transactional in PostgreSQL

---

## Bonus Features

- **WebSocket live feed** — Dashboard auto-updates without polling
- **Ring Buffer backpressure** — Memory-safe burst handling
- **Audit trail** — Every state transition logged in `state_transitions` table
- **Redis eviction policy** — `allkeys-lru` ensures cache doesn't grow unbounded
- **Nginx gzip compression** — Faster frontend delivery
- **Unit tests** — RCA validation and MTTR calculation fully tested

---

## Prompts / Plans Used

See `docs/PROMPTS.md` for the full design plan and prompts used during development.
