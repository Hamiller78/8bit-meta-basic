import { atari800xlTarget } from "./atari800xl.js";
import { c64Target } from "./c64.js";
import { spectrumTarget } from "./spectrum.js";
import type { TargetBackend, TargetId } from "./target.js";

const targets: Record<TargetId, TargetBackend> = {
  spectrum: spectrumTarget,
  atari800xl: atari800xlTarget,
  c64: c64Target
};

export type { TargetId };

export function getTarget(id: TargetId): TargetBackend {
  return targets[id];
}

export function isTargetId(value: string): value is TargetId {
  return value === "spectrum" || value === "atari800xl" || value === "c64";
}
