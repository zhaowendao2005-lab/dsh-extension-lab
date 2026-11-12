// Routing boundary: fingerprint → real Host service; custom tasks → local mock (no backend exists for them yet).
import type { Evaluation, Stage } from '../types';

export { createMockRun as createCustomRun, advanceMockRun as advanceCustomRun, cancelMockRun as cancelCustomRun } from './evaluations.mock';
export { applyFingerprintRun, cancelFingerprint, configureFingerprint, createFingerprintRun, failFingerprintRun, fingerprintValuesEqual, pollFingerprint, retryFingerprint, startFingerprint } from '../service/fingerprint.service';

// Generic record helpers are not simulation APIs; real fingerprint records never call into .mock.
export const terminal = (stage: Stage): boolean => ['completed', 'failed', 'timeout', 'cancelled'].includes(stage);
export function snapshotEvaluation(evaluation: Evaluation): Evaluation {
  return { ...evaluation, runIds: [...evaluation.runIds], ...(evaluation.preset ? { preset: { ...evaluation.preset } } : {}),
    ...(evaluation.fingerprint ? { fingerprint: { ...evaluation.fingerprint,
      challenges: evaluation.fingerprint.challenges.map(challenge => ({ ...challenge })),
      ...(evaluation.fingerprint.reference ? { reference: { ...evaluation.fingerprint.reference } } : {}),
    } } : {}),
  };
}
