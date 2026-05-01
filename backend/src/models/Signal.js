import mongoose from 'mongoose';

// Raw signal schema - stored in MongoDB (NoSQL data lake / audit log)
const signalSchema = new mongoose.Schema({
  work_item_id: { type: String, index: true, default: null },
  component_id: { type: String, required: true, index: true },
  component_type: {
    type: String,
    enum: ['API', 'MCP_HOST', 'CACHE', 'QUEUE', 'RDBMS', 'NOSQL'],
    required: true,
  },
  error_code: { type: String },
  message: { type: String, required: true },
  latency_ms: { type: Number },
  severity: { type: String, enum: ['P0', 'P1', 'P2', 'P3'], required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  received_at: { type: Date, default: Date.now, index: true },
}, {
  collection: 'signals',
  timestamps: false,
});

// Compound index for debounce queries
signalSchema.index({ component_id: 1, received_at: -1 });

export const Signal = mongoose.model('Signal', signalSchema);
