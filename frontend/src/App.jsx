import React from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import IncidentDetail from './pages/IncidentDetail.jsx';
import History from './pages/History.jsx';
import './styles.css';

function Nav() {
  const loc = useLocation();
  return (
    <nav className="nav">
      <div className="nav-brand">
        <span className="nav-dot" />
        <span className="nav-title">IMS</span>
        <span className="nav-sub">Incident Management</span>
      </div>
      <div className="nav-links">
        <Link to="/" className={loc.pathname === '/' ? 'active' : ''}>Live Feed</Link>
        <Link to="/history" className={loc.pathname === '/history' ? 'active' : ''}>History</Link>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/incident/:id" element={<IncidentDetail />} />
          <Route path="/history" element={<History />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
