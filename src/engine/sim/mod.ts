// The simulated environment (phase-2): a multi-process cluster, a message-level
// network with seeded faults, and a crash-aware file model. Internal to the
// engine; not re-exported from the package index.

export {
  Cluster,
  type ControllerDeps,
  DirectNetwork,
  directNetwork,
  type Network,
  type NetworkDeps,
  type NetworkFactory,
  type Node,
  type NodeDeps,
  type ProcessId,
} from "./cluster.ts";
export { type LinkConfig, SimulatedNetwork, simulatedNetwork } from "./network.ts";
export { type FileIOConfig, SimulatedFileIO, TickFuture } from "./fileio.ts";
export {
  type DecisionConfig,
  type FaultInjector,
  type FaultKind,
  type ScheduleEntry,
  SimulationDecisions,
} from "./decisions.ts";
export { FAULT_PROFILES, faultProfile, type RequestGen, Workload, type WorkloadConfig } from "./workload.ts";
export {
  BufferedFramer,
  type ByteChannelConfig,
  type ByteSink,
  encodeFrames,
  NaiveFramer,
  SimulatedByteChannel,
} from "./byte_network.ts";
