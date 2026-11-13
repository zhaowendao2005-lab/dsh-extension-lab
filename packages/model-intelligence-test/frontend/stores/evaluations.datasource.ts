// Routing boundary: records/attempts and fingerprint facts → real Host service;
// custom task execution → local mock (no backend exists for it yet; its snapshots are persisted on the Host).
import type { Stage } from '../types';

export { createMockRun as createCustomRun, advanceMockRun as advanceCustomRun, cancelMockRun as cancelCustomRun } from './evaluations.mock';
export {
  applyFingerprintRun, createFingerprintRun, failFingerprintRun, fingerprintValuesEqual, modelOfRef,
  listRecords, createRecord, rerunRecord, deleteRecord, clearRecords, readAttempt, cancelAttempt, configureAttempt, retryAttempt, saveCustomAttempt,
} from '../service/fingerprint.service';

// Generic record helper, not a simulation API.
export const terminal = (stage: Stage): boolean => ['completed', 'failed', 'timeout', 'cancelled'].includes(stage);
