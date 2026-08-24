export const deviceDefinitions = [
  { kind: "printer", cliName: "printer" },
  { kind: "text-printer", cliName: "text-printer" },
  { kind: "shared-drive", cliName: "shared-drive" },
  { kind: "rs232", cliName: "rs232" }
];

export const deviceKindUsage = deviceDefinitions.map((device) => device.cliName).join("|");
export const deviceKindList = listWithOr(deviceDefinitions.map((device) => device.cliName));

export function parseDeviceKind(value, optionName = "--test-output-device") {
  const normalized = value.toLowerCase();
  const device = deviceDefinitions.find((definition) => definition.cliName === normalized);
  if (!device) {
    throw new Error(`Invalid ${optionName} value "${value}". Expected ${deviceKindList}.`);
  }
  return device.kind;
}

function listWithOr(values) {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  return `${values.slice(0, -1).join(", ")}, or ${values[values.length - 1]}`;
}
