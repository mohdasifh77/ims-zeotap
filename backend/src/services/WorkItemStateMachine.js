// ── STATE PATTERN: Work Item Lifecycle ───────────────────────────────────────
// Manages valid transitions: OPEN → INVESTIGATING → RESOLVED → CLOSED
// CLOSED requires a complete RCA object.

const VALID_TRANSITIONS = {
  OPEN:          ['INVESTIGATING'],
  INVESTIGATING: ['RESOLVED'],
  RESOLVED:      ['CLOSED'],
  CLOSED:        [], // terminal state
};

export class WorkItemStateMachine {
  /**
   * Validate a state transition.
   * @param {string} currentStatus
   * @param {string} targetStatus
   * @param {object|null} rca - Required when transitioning to CLOSED
   * @returns {{ valid: boolean, error?: string }}
   */
  static validate(currentStatus, targetStatus, rca = null) {
    const allowed = VALID_TRANSITIONS[currentStatus];

    if (!allowed) {
      return { valid: false, error: `Unknown current status: ${currentStatus}` };
    }

    if (!allowed.includes(targetStatus)) {
      return {
        valid: false,
        error: `Cannot transition from ${currentStatus} to ${targetStatus}. Allowed: [${allowed.join(', ') || 'none'}]`,
      };
    }

    // ── MANDATORY RCA CHECK ────────────────────────────────────────────────────
    if (targetStatus === 'CLOSED') {
      if (!rca) {
        return { valid: false, error: 'RCA is required before closing an incident.' };
      }
      const missing = [];
      if (!rca.root_cause_category) missing.push('root_cause_category');
      if (!rca.fix_applied?.trim())  missing.push('fix_applied');
      if (!rca.prevention_steps?.trim()) missing.push('prevention_steps');
      if (!rca.incident_start)       missing.push('incident_start');
      if (!rca.incident_end)         missing.push('incident_end');

      if (missing.length > 0) {
        return { valid: false, error: `RCA is incomplete. Missing fields: ${missing.join(', ')}` };
      }
    }

    return { valid: true };
  }

  /**
   * Calculate MTTR in seconds.
   * @param {Date} startTime
   * @param {Date} endTime
   * @returns {number}
   */
  static calcMTTR(startTime, endTime) {
    return Math.round((new Date(endTime) - new Date(startTime)) / 1000);
  }
}
