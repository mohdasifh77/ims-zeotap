import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api.js';
import { useWebSocket } from '../hooks/useWebSocket.js';

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString();
}

export default function Dashboard() {
  const [items, setItems] = useState([]);
  const [metrics, setMetrics] = useState({ rate: 0, buffer: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadItems = useCallback(async () => {
    try {
      const data = await api.get('/work-items');
      const sorted = (data.data || []).sort(
        (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
      );
      setItems(sorted);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const t = setInterval(loadItems, 10_000);
    return () => clearInterval(t);
  }, [loadItems]);

  const wsConnected = useWebSocket((msg) => {
    if (msg.type === 'metrics') {
      setMetrics({ rate: msg.rate, buffer: msg.buffer, total: msg.total });
    }
  });

  const counts = {
    P0: items.filter(i => i.priority === 'P0').length,
    open: items.filter(i => i.status === 'OPEN').length,
    investigating: items.filter(i => i.status === 'INVESTIGATING').length,
    total: items.length,
  };

  return (
    <div>
      <div className="page-header">
        <h1>LIVE INCIDENT FEED</h1>
        <p>
          <span className={`ws-dot ${wsConnected ? 'on' : 'off'}`} />
          {wsConnected ? 'Live' : 'Reconnecting...'} · {items.length} active incident{items.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Metrics */}
      <div className="metrics-bar">
        <div className="metric-card">
          <div className="metric-label">Signals / sec</div>
          <div className="metric-value highlight">{metrics.rate}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Buffer</div>
          <div className="metric-value">{metrics.buffer}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Ingested</div>
          <div className="metric-value">{metrics.total.toLocaleString()}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">P0 Critical</div>
          <div className="metric-value" style={{ color: counts.P0 > 0 ? 'var(--p0)' : 'inherit' }}>{counts.P0}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Open</div>
          <div className="metric-value">{counts.open}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Investigating</div>
          <div className="metric-value">{counts.investigating}</div>
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading incidents...</div>
      ) : items.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">✓</div>
          <p>No active incidents. System healthy.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="incident-table">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Title</th>
                <th>Component</th>
                <th>Status</th>
                <th>Signals</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr
                  key={item.id}
                  className={`incident-row p${item.priority?.slice(1)?.toLowerCase() || '2'}`}
                  onClick={() => navigate(`/incident/${item.id}`)}
                >
                  <td><span className={`priority priority-${item.priority}`}>{item.priority}</span></td>
                  <td>
                    <div className="incident-title">{item.title}</div>
                  </td>
                  <td><span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{item.component_id}</span></td>
                  <td><span className={`badge badge-${item.status}`}>{item.status}</span></td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{item.signal_count}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-dim)' }}>{fmt(item.start_time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
