import mongoose from 'mongoose';
import pg from 'pg';
import Redis from 'ioredis';

const { Pool } = pg;

// ── MongoDB connection ────────────────────────────────────────────────────────
export async function connectMongo() {
  const uri = process.env.MONGO_URI || 'mongodb://ims_user:ims_pass@localhost:27017/ims_signals?authSource=admin';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  console.log('✅ MongoDB connected');
}

// ── PostgreSQL connection pool ────────────────────────────────────────────────
export const pgPool = new Pool({
  connectionString: process.env.POSTGRES_URI || 'postgresql://ims_user:ims_pass@localhost:5432/ims_workitems',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pgPool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

export async function connectPostgres() {
  const client = await pgPool.connect();
  client.release();
  console.log('✅ PostgreSQL connected');
}

// ── Redis connection ──────────────────────────────────────────────────────────
export const redis = new Redis(process.env.REDIS_URI || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

redis.on('error', (err) => console.error('Redis error:', err.message));

export async function connectRedis() {
  await redis.connect();
  console.log('✅ Redis connected');
}
