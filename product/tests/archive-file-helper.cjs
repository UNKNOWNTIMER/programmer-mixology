// Test-only, read-only decoder. Production validation remains Rust archive.rs.
const fs = require('node:fs');
const { createHash, timingSafeEqual } = require('node:crypto');
const SEPARATOR = Buffer.from('\nPIXELMIX-ARCHIVE/2\n');
const FOOTER = Buffer.from('PMIX-END2');

function inspectArchiveFile(input) {
  const bytes = Buffer.from(input);
  if (bytes.length > 524288) throw new Error('Archive exceeds 512 KiB');
  if (!bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) {
    return { value: JSON.parse(bytes.toString('utf8')), embeddedIcon: false, sizes: [], iconBytes: 0 };
  }
  // Layout: ICO | separator | JSON | uint32LE JSON byte length |
  // SHA256(all bytes through the length field) | "PMIX-END2".
  const lengthAt = bytes.length - (4 + 32 + FOOTER.length);
  if (lengthAt < 6 || !bytes.subarray(-FOOTER.length).equals(FOOTER)) throw new Error('Invalid icon archive footer');
  const jsonLength = bytes.readUInt32LE(lengthAt);
  const jsonStart = lengthAt - jsonLength;
  const iconEnd = jsonStart - SEPARATOR.length;
  if (iconEnd < 6 || !bytes.subarray(iconEnd, jsonStart).equals(SEPARATOR)) throw new Error('Invalid icon archive bounds');
  const expected = createHash('sha256').update(bytes.subarray(0, lengthAt + 4)).digest();
  if (!timingSafeEqual(expected, bytes.subarray(lengthAt + 4, lengthAt + 36))) throw new Error('Icon archive checksum mismatch');
  const count = bytes.readUInt16LE(4);
  if (!count || count > 8 || 6 + count * 16 > iconEnd) throw new Error('Invalid ICO count');
  let offset = 6 + count * 16;
  const sizes = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + 16 * i;
    const width = bytes[at] || 256;
    const height = bytes[at + 1] || 256;
    const length = bytes.readUInt32LE(at + 8);
    if (width !== height || bytes.readUInt32LE(at + 12) !== offset || length > iconEnd - offset) throw new Error('Invalid ICO frame bounds');
    sizes.push(width);
    offset += length;
  }
  if (offset !== iconEnd) throw new Error('Unexpected bytes inside ICO');
  return { value: JSON.parse(bytes.subarray(jsonStart, lengthAt).toString('utf8')),
    embeddedIcon: true, sizes, iconBytes: iconEnd,
    iconSha256: createHash('sha256').update(bytes.subarray(0, iconEnd)).digest('hex') };
}

function parseArchiveFile(bytes) { return inspectArchiveFile(bytes).value; }
function readArchiveFile(path) { return parseArchiveFile(fs.readFileSync(path)); }
module.exports = { inspectArchiveFile, parseArchiveFile, readArchiveFile };
