// Dependency-free JS port of backend/lambda/t9_wizard/utils.py's
// unpack_input_log. Entry format is INPUT_LOG_ENTRY_FORMAT = "<IB" there:
// a little-endian uint32 tick followed by a uint8 ASCII key code, 5 bytes
// per entry. Kept byte-for-byte compatible with that format on purpose --
// this is decoding the exact same DynamoDB `input_log_packed` Binary
// attribute (base64-encoded when copied out of the console/CLI as JSON).
'use strict';

const ENTRY_SIZE = 5; // 4 (uint32 tick) + 1 (uint8 key code)

// bytes: Uint8Array (or Buffer) of raw packed input_log data.
function unpackInputLog(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  for (let offset = 0; offset + ENTRY_SIZE <= bytes.byteLength; offset += ENTRY_SIZE) {
    const tick = view.getUint32(offset, /* littleEndian */ true);
    const keyCode = view.getUint8(offset + 4);
    entries.push({ tick, key: String.fromCharCode(keyCode) });
  }
  return entries;
}

// base64: the exact string form DynamoDB Binary attributes take when
// serialized to JSON (e.g. pasted from the console, or from a raw
// get-item --output json call) -- what you get for `input_log_packed`.
function unpackInputLogBase64(base64) {
  const bytes = Buffer.from(base64, 'base64');
  return unpackInputLog(bytes);
}

// Accepts either a run object with a plain `input_log` array already
// (e.g. from a future DynamoDB-puller mirroring get_champion_run's return
// shape) or one with `input_log_packed` (base64) -- returns the same run
// object with a guaranteed-present, plain `input_log` array.
function resolveInputLog(run) {
  if (Array.isArray(run.input_log)) return run.input_log;
  if (typeof run.input_log_packed === 'string') return unpackInputLogBase64(run.input_log_packed);
  throw new Error('run JSON must have either "input_log" (array) or "input_log_packed" (base64 string)');
}

module.exports = { unpackInputLog, unpackInputLogBase64, resolveInputLog, ENTRY_SIZE };
