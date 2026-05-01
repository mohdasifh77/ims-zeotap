import { WorkItemStateMachine } from '../src/services/WorkItemStateMachine.js';

describe('WorkItemStateMachine - State Transitions', () => {
  test('OPEN → INVESTIGATING is valid', () => {
    const result = WorkItemStateMachine.validate('OPEN', 'INVESTIGATING');
    expect(result.valid).toBe(true);
  });

  test('OPEN → CLOSED is invalid (must go through INVESTIGATING)', () => {
    const result = WorkItemStateMachine.validate('OPEN', 'CLOSED');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Cannot transition');
  });

  test('INVESTIGATING → RESOLVED is valid', () => {
    const result = WorkItemStateMachine.validate('INVESTIGATING', 'RESOLVED');
    expect(result.valid).toBe(true);
  });

  test('RESOLVED → CLOSED without RCA is invalid', () => {
    const result = WorkItemStateMachine.validate('RESOLVED', 'CLOSED', null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('RCA is required');
  });

  test('RESOLVED → CLOSED with incomplete RCA is invalid', () => {
    const incompleteRca = {
      root_cause_category: 'HARDWARE',
      fix_applied: '',  // empty!
      prevention_steps: 'Monitor disk health',
      incident_start: new Date(),
      incident_end: new Date(),
    };
    const result = WorkItemStateMachine.validate('RESOLVED', 'CLOSED', incompleteRca);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('fix_applied');
  });

  test('RESOLVED → CLOSED with complete RCA is valid', () => {
    const completeRca = {
      root_cause_category: 'HARDWARE',
      fix_applied: 'Replaced failed disk node',
      prevention_steps: 'Add disk health monitoring alerts',
      incident_start: new Date('2024-01-01T10:00:00Z'),
      incident_end: new Date('2024-01-01T12:00:00Z'),
    };
    const result = WorkItemStateMachine.validate('RESOLVED', 'CLOSED', completeRca);
    expect(result.valid).toBe(true);
  });

  test('CLOSED → any state is invalid (terminal)', () => {
    const result = WorkItemStateMachine.validate('CLOSED', 'OPEN');
    expect(result.valid).toBe(false);
  });
});

describe('WorkItemStateMachine - MTTR Calculation', () => {
  test('Calculates correct MTTR in seconds', () => {
    const start = new Date('2024-01-01T10:00:00Z');
    const end   = new Date('2024-01-01T11:30:00Z'); // 90 minutes = 5400 seconds
    expect(WorkItemStateMachine.calcMTTR(start, end)).toBe(5400);
  });

  test('MTTR is 0 for same start and end', () => {
    const t = new Date();
    expect(WorkItemStateMachine.calcMTTR(t, t)).toBe(0);
  });
});
