const encoder = new TextEncoder();

/** Chrome measures local-storage usage from JSON-serialized keys and values. */
export function serializedByteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}
