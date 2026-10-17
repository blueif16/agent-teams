/*
 * The lead's durable project state (F §3, §9; M1/M2), in the vault at projects/<pid>/state/.
 * Read side for the UI and the window opener; leadTools/workerTools for the runtime to register (not wired here).
 */
export * from "./digest";
export * from "./format";
export * from "./schema";
export { journalPath, readState, reportPath, statePath } from "./store";
export { StateError, type StateErrorCode } from "./rules";
export { addMember, type Dispatch, type DispatchRequest, type MemberInput, type StateDelta, type StateDeps } from "./ops";
export { leadTools, takeDeltas, workerTools, type LeadDeps, type WorkerDeps } from "./tools";
