// ── In-Memory Ring Buffer ─────────────────────────────────────────────────────
// Handles bursts of up to 10,000 signals/sec without crashing if DB is slow.
// Uses a circular buffer (ring buffer) to avoid unbounded memory growth.

const BUFFER_SIZE = 50_000; // max signals held in memory

class RingBuffer {
  constructor(capacity) {
    this.buffer = new Array(capacity);
    this.capacity = capacity;
    this.head = 0;   // next write position
    this.tail = 0;   // next read position
    this.size = 0;
  }

  push(item) {
    if (this.size === this.capacity) {
      // Buffer full - drop oldest (tail) to make room (backpressure: drop)
      this.tail = (this.tail + 1) % this.capacity;
      this.size--;
    }
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    this.size++;
  }

  pop() {
    if (this.size === 0) return null;
    const item = this.buffer[this.tail];
    this.buffer[this.tail] = undefined; // allow GC
    this.tail = (this.tail + 1) % this.capacity;
    this.size--;
    return item;
  }

  drain(maxCount = 500) {
    const items = [];
    while (items.length < maxCount && this.size > 0) {
      items.push(this.pop());
    }
    return items;
  }

  get length() { return this.size; }
  get isFull()  { return this.size === this.capacity; }
}

// ── Metrics ───────────────────────────────────────────────────────────────────
let totalIngested = 0;
let windowIngested = 0;

export function incrementMetrics() {
  totalIngested++;
  windowIngested++;
}

export function getAndResetWindowMetrics() {
  const val = windowIngested;
  windowIngested = 0;
  return val;
}

export function getTotalIngested() { return totalIngested; }

// ── Singleton buffer ──────────────────────────────────────────────────────────
export const signalBuffer = new RingBuffer(BUFFER_SIZE);
