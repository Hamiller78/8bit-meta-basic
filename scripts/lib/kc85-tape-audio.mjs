// KC 85 cassette encoding: 128-byte blocks with additive checksums, LSB first.
// The timing matches the KC 85/3 tape interface at a 22050 Hz sample rate.
export function kc85TapeName(name) {
  return name.toUpperCase().replace(/[^A-Z0-9]/gu, "").slice(0, 8) || "PROGRAM";
}

export function createKc85TapeWav(sss, name) {
  if (!Buffer.isBuffer(sss) || sss.length < 128 || sss.length % 128 !== 0) throw new Error("Invalid KC 85 .sss file: expected padded BASIC data.");
  const length = sss.readUInt16LE(0);
  if (length < 2 || length + 3 > sss.length || sss[length + 2] !== 3) throw new Error("Invalid KC 85 .sss file: incorrect program length or end marker.");
  const tapeName = kc85TapeName(name);
  const bytes = Buffer.alloc(Math.ceil((14 + length) / 128) * 128);
  if (bytes.length / 128 > 255) throw new Error("KC 85 cassette export exceeds 255 tape blocks.");
  bytes.fill(0xd3, 0, 3);
  bytes.fill(0x20, 3, 11);
  bytes.write(tapeName, 3, "ascii");
  bytes.writeUInt16LE(length, 11);
  sss.copy(bytes, 13, 2, 2 + length);
  bytes[13 + length] = 3;

  const runs = [];
  let phase = false;
  const toggle = (count) => { phase = !phase; runs.push([count, phase ? 224 : 32]); };
  const byte = (value) => {
    for (let bit = 0; bit < 8; bit += 1) {
      const half = value & (1 << bit) ? 10 : 5;
      toggle(half); toggle(half);
    }
    toggle(20); toggle(20);
  };
  for (let offset = 0; offset < bytes.length; offset += 128) {
    if (offset > 0) runs.push([240, phase ? 224 : 32]);
    const leader = offset === 0 ? 8000 : 320;
    for (let index = 0; index < leader; index += 1) toggle(10);
    toggle(20); toggle(20);
    const index = offset / 128;
    byte(index === 0 ? 1 : offset + 128 === bytes.length ? 255 : (index + 1) & 255);
    let checksum = 0;
    for (const value of bytes.subarray(offset, offset + 128)) { byte(value); checksum = (checksum + value) & 255; }
    byte(checksum);
  }
  toggle(20);
  runs.push([11025, 128]);
  const size = runs.reduce((sum, run) => sum + run[0], 0);
  const wav = Buffer.alloc(44 + size);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + size, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(22050, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
  wav.write("data", 36); wav.writeUInt32LE(size, 40);
  let position = 44;
  for (const [count, value] of runs) { wav.fill(value, position, position + count); position += count; }
  return wav;
}
