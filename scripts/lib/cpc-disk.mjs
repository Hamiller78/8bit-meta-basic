import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Standard CPC DATA format: 40 tracks, nine 512-byte sectors and 1 KiB blocks.
// The first two blocks are the CP/M directory; ASCII files have no AMSDOS header.
const TRACKS = 40;
const SECTOR_SIZE = 512;
const SECTORS_PER_TRACK = 9;
const TRACK_BYTES = SECTOR_SIZE * SECTORS_PER_TRACK;
const BLOCK_SIZE = 1024;
const DIRECTORY_BYTES = 2048;
const EXTENT_BYTES = 16 * BLOCK_SIZE;

/** Do not overwrite a disk image changed since the last generated build. */
export async function writeCpcDiskImage(path, image) {
  const fingerprintPath = `${path}.sha256`;
  const digest = (data) => createHash("sha256").update(data).digest("hex");
  let existing;
  try { existing = await readFile(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing) {
    let recorded;
    try { recorded = (await readFile(fingerprintPath, "utf8")).trim(); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (digest(existing) !== (recorded || digest(image))) {
      throw new Error(`CPC disk image ${path} has changed since it was generated; preserve or move it before rebuilding.`);
    }
  }
  await writeFile(path, image);
  await writeFile(fingerprintPath, `${digest(image)}\n`, "utf8");
}

/** Package one ASCII BASIC listing in a standard single-sided CPC DATA disk. */
export function createCpcDataDisk(filename, listing) {
  const match = /^([A-Z0-9_]{1,8})\.([A-Z0-9_]{1,3})$/i.exec(filename);
  if (!match) throw new Error("CPC disk filename must have an 8.3 alphanumeric or underscore name.");
  if (typeof listing !== "string" || /[^\x09\x0a\x0d\x20-\x7e]/.test(listing)) {
    throw new Error("CPC ASCII BASIC listing must contain only ASCII text.");
  }
  const text = listing.replace(/\r\n|\r|\n/g, "\r\n");
  const content = Buffer.concat([Buffer.from(text, "ascii"), Buffer.from([0x1a])]);
  const diskData = Buffer.alloc(TRACKS * TRACK_BYTES, 0xe5);
  const blocks = Math.ceil(content.length / BLOCK_SIZE);
  const extents = Math.ceil(content.length / EXTENT_BYTES);
  if (blocks > diskData.length / BLOCK_SIZE - DIRECTORY_BYTES / BLOCK_SIZE || extents > 64) {
    throw new Error("CPC BASIC listing exceeds the capacity of a DATA disk.");
  }
  for (let extent = 0; extent < extents; extent += 1) {
    const entry = diskData.subarray(extent * 32, (extent + 1) * 32);
    entry.fill(0);
    entry.write(match[1].toUpperCase().padEnd(8), 1, "ascii");
    entry.write(match[2].toUpperCase().padEnd(3), 9, "ascii");
    entry[12] = extent & 0x1f;
    entry[14] = extent >> 5;
    const extentLength = Math.min(EXTENT_BYTES, content.length - extent * EXTENT_BYTES);
    entry[15] = Math.ceil(extentLength / 128);
    const extentBlocks = Math.ceil(extentLength / BLOCK_SIZE);
    for (let block = 0; block < extentBlocks; block += 1) {
      entry[16 + block] = 2 + extent * 16 + block;
    }
  }
  content.copy(diskData, DIRECTORY_BYTES);

  const trackSize = 256 + TRACK_BYTES;
  const image = Buffer.alloc(256 + TRACKS * trackSize);
  image.write("MV - CPCEMU Disk-File\r\nDisk-Info\r\n", 0, "ascii");
  image.write("Meta-BASIC", 0x22, "ascii");
  image[0x30] = TRACKS;
  image[0x31] = 1;
  image.writeUInt16LE(trackSize, 0x32);
  for (let track = 0; track < TRACKS; track += 1) {
    const offset = 256 + track * trackSize;
    image.write("Track-Info\r\n", offset, "ascii");
    image[offset + 0x10] = track;
    image[offset + 0x14] = 2;
    image[offset + 0x15] = SECTORS_PER_TRACK;
    image[offset + 0x16] = 0x4e;
    image[offset + 0x17] = 0xe5;
    for (let sector = 0; sector < SECTORS_PER_TRACK; sector += 1) {
      const info = offset + 0x18 + sector * 8;
      image[info] = track;
      image[info + 2] = 0xc1 + sector;
      image[info + 3] = 2;
    }
    diskData.copy(image, offset + 256, track * TRACK_BYTES, (track + 1) * TRACK_BYTES);
  }
  return image;
}
