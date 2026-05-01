import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api.js';

function fmt(dt) { return dt ? new Date(dt).toLocaleString() : '—'; }
function mttrFmt(s) {
  if (!s) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

export default function History() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/work-items/all')
      .then(d => setItems(d.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === 'ALL' ? items : items.filter(i => i.status === filter);

  return (
    <div>
      <div className="page-header">
        <h1>INCIDENT HISTORY</h1>
        <p>All incidents including closed ones with RCA</p>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem' }}>
        {['ALL', 'OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'].map(s => (
          <button
            key={s}
            className={`btn ${filter === s ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '6px 14px', fontSize: '0.75rem' }}
            onClick={() => setFilter(s)}
          >{s}</button>
        ))}
      </div>

      {loading ? (
        <div className="loading">Loading history...</div>
      ) : filtered.length === 0 ? (
        <div className="empty"><div className="empty-icon">📋</div><p>No incidents found.</p></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="incident-table">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Title</th>
                <th>Status</th>
                <th>Signals</th>
                <th>Started</th>
                <th>MTTR</th>
                <th>RCA</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr
                  key={item.id}
                  className={`incident-row p${item.priority?.slice(1)?.toLowerCase() || '2'}`}
                  onClick={() => navigate(`/incident/${item.id}`)}
                >
                  <td><span className={`priority priority-${item.priority}`}>{item.priority}</span></td>
                  <td><div className="incident-title">{item.title}</div><div className="incident-meta">{item.component_id}</div></td>
                  <td><span className={`badge badge-${item.status}`}>{item.status}</span></td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{item.signal_count}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-dim)' }}>{fmt(item.start_time)}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{mttrFmt(item.mttr_seconds)}</td>
                  <td>
                    {item.root_cause_category
                      ? <span style={{ color: 'var(--p3)', fontSize: '0.78rem' }}>✓ {item.root_cause_category.replace(/_/g, ' ')}</span>
                      : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
