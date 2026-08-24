export const deviceDefinitions = [
  { kind: "printer", sourceName: "PRINTER", cliName: "printer" },
  { kind: "text-printer", sourceName: "TEXT_PRINTER", cliName: "text-printer" },
  { kind: "rs232", sourceName: "RS232", cliName: "rs232" }
] as const;

export type DeviceKind = (typeof deviceDefinitions)[number]["kind"];

export const deviceCliNames = deviceDefinitions.map((device) => device.cliName);
export const deviceSourceNames = deviceDefinitions.map((device) => device.sourceName);
export const deviceCliUsage = deviceCliNames.join("|");
export const deviceCliList = listValues(deviceCliNames.map((name) => `"${name}"`), "or");
export const deviceSourceList = listValues(deviceSourceNames, "and");

export function parseSourceDeviceName(name: string): DeviceKind | undefined {
  return deviceDefinitions.find((device) => device.sourceName === name.toUpperCase())?.kind;
}

export function isSourceDeviceName(name: string): boolean {
  return parseSourceDeviceName(name) !== undefined;
}

export function isDeviceKind(value: unknown): value is DeviceKind {
  return typeof value === "string" && deviceDefinitions.some((device) => device.kind === value);
}

export function parseDeviceKind(value: string): DeviceKind | undefined {
  const normalized = value.toLowerCase();
  return deviceDefinitions.find((device) => device.cliName === normalized)?.kind;
}

export function requireDeviceKind(value: string, optionName = "--test-output-device"): DeviceKind {
  const device = parseDeviceKind(value);
  if (!device) {
    throw new Error(`Invalid ${optionName} value "${value}". Expected ${deviceCliList}.`);
  }
  return device;
}

function listValues(values: readonly string[], conjunction: "and" | "or"): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  return `${values.slice(0, -1).join(", ")}, ${conjunction} ${values[values.length - 1]}`;
}
