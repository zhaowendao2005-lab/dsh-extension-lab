// Routing boundary: records, attempts and all execution facts are supplied by Host services.
export {
  applyFingerprintRun, createFingerprintRun, failFingerprintRun, fingerprintValuesEqual, modelOfRef,
  listRecords, createRecord, rerunRecord, renameRecord, deleteRecord, clearRecords, readAttempt, cancelAttempt, configureAttempt, retryAttempt,
} from '../service/fingerprint.service';
export { applyCustomRun } from '../service/custom.service';

import type { Stage } from '../types';
export const terminal = (stage: Stage): boolean => ['completed', 'failed', 'timeout', 'cancelled', 'interrupted'].includes(stage);
