/**
 * Task tool module exports.
 */

export { taskTool, setWorkerManager, getWorkerManager, clearWorkerManager } from './task.js';
export {
  WorkerManager,
  type WorkerModel,
  type WorkerConfig,
  type WorkerInfo,
  type WorkerResult,
} from './worker-manager.js';
