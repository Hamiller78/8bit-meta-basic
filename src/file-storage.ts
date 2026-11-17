import type { TargetId } from "./targets/target.js";

export type FileStorage = "disk" | "tape";

export function defaultFileStorage(target: TargetId): FileStorage {
  return target === "spectrum" || target === "kc85" ? "tape" : "disk";
}

export function requireFileStorage(value: unknown): FileStorage {
  if (value === "disk" || value === "tape") return value;
  throw new Error('File storage must be "disk" or "tape".');
}

export function validateFileStorage(target: TargetId, storage: FileStorage): void {
  if (target === "spectrum" && storage !== "tape") throw new Error("ZX Spectrum file I/O currently supports tape storage only.");
  if (target === "agon" && storage !== "disk") throw new Error("Agon file I/O currently supports SD-card file storage only.");
  if (target === "kc85" && storage !== "tape") throw new Error("KC 85/3 supports tape storage only in this configuration.");
}
