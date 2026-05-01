// ── STRATEGY PATTERN: Alerting ────────────────────────────────────────────────
// Each component type has a different alerting strategy (priority + message)

class AlertStrategy {
  getAlert(signal) { throw new Error('getAlert() must be implemented'); }
}

class RDBMSAlertStrategy extends AlertStrategy {
  getAlert(signal) {
    return {
      priority: 'P0',
      title: `[P0] RDBMS Failure: ${signal.component_id}`,
      message: `Critical database failure detected on ${signal.component_id}. Immediate action required.`,
      escalate: true,
      pagerDuty: true,
    };
  }
}

class APIAlertStrategy extends AlertStrategy {
  getAlert(signal) {
    const priority = signal.latency_ms > 5000 ? 'P1' : 'P2';
    return {
      priority,
      title: `[${priority}] API Degradation: ${signal.component_id}`,
      message: `API ${signal.component_id} is experiencing errors. Latency: ${signal.latency_ms}ms`,
      escalate: priority === 'P1',
      pagerDuty: false,
    };
  }
}

class CacheAlertStrategy extends AlertStrategy {
  getAlert(signal) {
    return {
      priority: 'P2',
      title: `[P2] Cache Failure: ${signal.component_id}`,
      message: `Cache cluster ${signal.component_id} is degraded. System may experience slowdowns.`,
      escalate: false,
      pagerDuty: false,
    };
  }
}

class QueueAlertStrategy extends AlertStrategy {
  getAlert(signal) {
    return {
      priority: 'P1',
      title: `[P1] Queue Failure: ${signal.component_id}`,
      message: `Async queue ${signal.component_id} is backed up or failing. Messages may be lost.`,
      escalate: true,
      pagerDuty: false,
    };
  }
}

class MCPHostAlertStrategy extends AlertStrategy {
  getAlert(signal) {
    return {
      priority: 'P1',
      title: `[P1] MCP Host Down: ${signal.component_id}`,
      message: `MCP Host ${signal.component_id} is unresponsive.`,
      escalate: true,
      pagerDuty: false,
    };
  }
}

class NoSQLAlertStrategy extends AlertStrategy {
  getAlert(signal) {
    return {
      priority: 'P2',
      title: `[P2] NoSQL Degradation: ${signal.component_id}`,
      message: `NoSQL store ${signal.component_id} is experiencing high latency or errors.`,
      escalate: false,
      pagerDuty: false,
    };
  }
}

// ── Alerting Context: picks the right strategy ────────────────────────────────
const strategyMap = {
  RDBMS: new RDBMSAlertStrategy(),
  API: new APIAlertStrategy(),
  CACHE: new CacheAlertStrategy(),
  QUEUE: new QueueAlertStrategy(),
  MCP_HOST: new MCPHostAlertStrategy(),
  NOSQL: new NoSQLAlertStrategy(),
};

export class AlertingContext {
  static getAlert(signal) {
    const strategy = strategyMap[signal.component_type] || new APIAlertStrategy();
    return strategy.getAlert(signal);
  }
}
