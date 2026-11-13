import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ build: vi.fn(), spawn: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../scripts/lib/build-target.mjs", () => ({
  buildTarget: mocks.build,
  outputPathFor: (cwd: string, outDir: string, profile: string, target: string, name: string, extension: string) =>
    join(cwd, outDir, profile, target, `${name}${extension}`),
  programIdentity: () => ({ name: "example" })
}));
vi.mock("../scripts/target-configurations.mjs", () => ({
  loadToolConfiguration: async () => ({}),
  resolveTargetConfiguration: () => ({ emulator: { path: "cap32.exe", configPath: "cap32.cfg" } })
}));

import { launchCpc } from "../scripts/lib/launch-cpc.mjs";

it("allows another interactive launch when an earlier session is running", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "metabasic-cpc-launch-"));
  try {
    const staging = join(cwd, "build", ".caprice32", "cpc");
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, "active.pid"), `${process.pid}\n`);
    await writeFile(join(cwd, "cap32.cfg"), "[system]\nauto_pause=1\nprinter=0\nresources_path=\n[file]\nprinter_file=\n[rom]\nrom_path=\n");
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const options = { cwd, source: "example.mbas", profile: "release", outDir: "build", configPath: "tools.json", targetConfiguration: "cpc", testMode: false, testPrinterOutput: false, hidden: false };
    await launchCpc(options);
    await launchCpc(options);
    expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
