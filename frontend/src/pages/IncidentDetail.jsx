import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api.js';

const ROOT_CAUSE_CATEGORIES = [
  'HARDWARE_FAILURE', 'SOFTWARE_BUG', 'CONFIGURATION_ERROR',
  'NETWORK_ISSUE', 'CAPACITY_EXHAUSTION', 'DEPENDENCY_FAILURE',
  'HUMAN_ERROR', 'SECURITY_INCIDENT', 'UNKNOWN',
];

const STATUS_FLOW = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'];

function fmt(dt) { return dt ? new Date(dt).toLocaleString() : '—'; }
function toLocal(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function IncidentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [transitioning, setTransitioning] = useState(false);

  // RCA form state
  const [rca, setRca] = useState({
    root_cause_category: '',
    fix_applied: '',
    prevention_steps: '',
    incident_start: '',
    incident_end: '',
  });

  const load = async () => {
    try {
      const d = await api.get(`/work-items/${id}`);
      setData(d);
      if (d.work_item.incident_start) {
        setRca({
          root_cause_category: d.work_item.root_cause_category || '',
          fix_applied: d.work_item.fix_applied || '',
          prevention_steps: d.work_item.prevention_steps || '',
          incident_start: toLocal(d.work_item.incident_start || d.work_item.start_time),
          incident_end: toLocal(d.work_item.incident_end),
        });
      } else {
        setRca(prev => ({
          ...prev,
          incident_start: toLocal(d.work_item.start_time),
        }));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const nextStatus = () => {
    if (!data) return null;
    const cur = STATUS_FLOW.indexOf(data.work_item.status);
    return cur < STATUS_FLOW.length - 1 ? STATUS_FLOW[cur + 1] : null;
  };

  const handleTransition = async (target) => {
    setError(''); setSuccess('');
    setTransitioning(true);
    try {
      await api.patch(`/work-items/${id}/status`, { status: target });
      setSuccess(`Status updated to ${target}`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setTransitioning(false);
    }
  };

  const handleRcaSubmit = async () => {
    setError(''); setSuccess('');
    try {
      const payload = {
        ...rca,
        incident_start: new Date(rca.incident_start).toISOString(),
        incident_end: new Date(rca.incident_end).toISOString(),
      };
      const res = await api.post(`/work-items/${id}/rca`, payload);
      setSuccess(res.message);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) return <div className="loading">Loading incident...</div>;
  if (error && !data) return <div className="error-msg">{error}</div>;

  const wi = data.work_item;
  const next = nextStatus();
  const hasRca = !!wi.root_cause_category;
  const mttrHuman = wi.mttr_seconds
    ? `${Math.floor(wi.mttr_seconds / 3600)}h ${Math.floor((wi.mttr_seconds % 3600) / 60)}m ${wi.mttr_seconds % 60}s`
    : null;

  return (
    <div>
      <Link to="/" className="back-link">← Back to Live Feed</Link>

      {error && <div className="error-msg">{error}</div>}
      {success && <div className="success-msg">{success}</div>}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <span className={`priority priority-${wi.priority}`} style={{ fontSize: '1rem' }}>{wi.priority}</span>
            <span className={`badge badge-${wi.status}`}>{wi.status}</span>
          </div>
          <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', lineHeight: 1.3 }}>{wi.title}</h1>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '6px', fontFamily: 'var(--font-mono)' }}>
            {wi.component_id} · {wi.signal_count} signals
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {next && next !== 'CLOSED' && (
            <button className="btn btn-secondary" onClick={() => handleTransition(next)} disabled={transitioning}>
              Move to {next}
            </button>
          )}
          {next === 'CLOSED' && (
            <button
              className="btn btn-primary"
              onClick={() => handleTransition('CLOSED')}
              disabled={transitioning || !hasRca}
              title={!hasRca ? 'Submit RCA first' : 'Close incident'}
            >
              Close Incident {!hasRca && '(RCA required)'}
            </button>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="card">
        <div className="card-title">Incident Details</div>
        <div className="detail-grid">
          <div className="detail-field"><label>Started</label><span>{fmt(wi.start_time)}</span></div>
          <div className="detail-field"><label>Ended</label><span>{fmt(wi.end_time)}</span></div>
          <div className="detail-field"><label>MTTR</label><span>{mttrHuman || '—'}</span></div>
          <div className="detail-field"><label>Signal Count</label><span>{wi.signal_count}</span></div>
        </div>
      </div>

      {/* State History */}
      <div className="card">
        <div className="card-title">State Timeline</div>
        <div className="timeline">
          {data.state_history.map((t, i) => (
            <div key={i} className="timeline-item">
              <div className="timeline-dot" />
              <div className="timeline-content">
                <div className="timeline-label">
                  {t.from_status ? `${t.from_status} → ${t.to_status}` : `Created as ${t.to_status}`}
                </div>
                <div className="timeline-time">{fmt(t.transitioned_at)}{t.reason ? ` · ${t.reason}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Raw Signals */}
      <div className="card">
        <div className="card-title">Raw Signals ({data.signals.length} shown)</div>
        {data.signals.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>No signals recorded yet.</div>
        ) : (
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {data.signals.map((s, i) => (
              <div key={i} className="signal-item">
                <div className="signal-time">{fmt(s.received_at)}</div>
                <div>
                  <span className={`priority priority-${s.severity}`} style={{ fontSize: '0.7rem', marginRight: '8px' }}>{s.severity}</span>
                  <span className="signal-msg">{s.message}</span>
                  {s.latency_ms > 0 && <span style={{ color: 'var(--text-dim)', marginLeft: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{s.latency_ms}ms</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RCA Form */}
      {wi.status !== 'OPEN' && (
        <div className="card">
          <div className="card-title">Root Cause Analysis {hasRca && '✓ Submitted'}</div>
          {wi.status === 'CLOSED' && hasRca ? (
            <div className="detail-grid">
              <div className="detail-field"><label>Category</label><span>{wi.root_cause_category}</span></div>
              <div className="detail-field"><label>Incident Start</label><span>{fmt(wi.incident_start)}</span></div>
              <div className="detail-field" style={{ gridColumn: '1/-1' }}><label>Fix Applied</label><span style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem' }}>{wi.fix_applied}</span></div>
              <div className="detail-field" style={{ gridColumn: '1/-1' }}><label>Prevention Steps</label><span style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem' }}>{wi.prevention_steps}</span></div>
            </div>
          ) : (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>Incident Start *</label>
                  <input type="datetime-local" value={rca.incident_start} onChange={e => setRca(p => ({ ...p, incident_start: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Incident End *</label>
                  <input type="datetime-local" value={rca.incident_end} onChange={e => setRca(p => ({ ...p, incident_end: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label>Root Cause Category *</label>
                <select value={rca.root_cause_category} onChange={e => setRca(p => ({ ...p, root_cause_category: e.target.value }))}>
                  <option value="">— Select —</option>
                  {ROOT_CAUSE_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Fix Applied *</label>
                <textarea rows={3} placeholder="Describe what was done to resolve the incident..." value={rca.fix_applied} onChange={e => setRca(p => ({ ...p, fix_applied: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Prevention Steps *</label>
                <textarea rows={3} placeholder="What steps will prevent this from recurring?..." value={rca.prevention_steps} onChange={e => setRca(p => ({ ...p, prevention_steps: e.target.value }))} />
              </div>
              <button className="btn btn-primary" onClick={handleRcaSubmit}>
                {hasRca ? 'Update RCA' : 'Submit RCA'}
              </button>
              {!hasRca && wi.status === 'RESOLVED' && (
                <p style={{ marginTop: '8px', color: 'var(--text-dim)', fontSize: '0.78rem' }}>
                  Submit RCA to enable closing this incident.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
