export function canonicalJson(value: unknown): string {
  return encode(normalize(value));
}

export function normalizeBackupValue(value: unknown): unknown {
  return normalize(value);
}

export function canonicalJsonUtf8ByteLength(value: unknown): number {
  return encodedByteLength(value);
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Backup data contains a non-finite number.");
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return { bytes: Array.from(value) };
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) throw new Error(`Backup data field ${key} is undefined.`);
      result[key] = normalize(record[key]);
    }
    return result;
  }
  throw new Error(`Backup data contains unsupported value type ${typeof value}.`);
}

function encode(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${encode(record[key])}`).join(",")}}`;
}

function encodedByteLength(value: unknown): number {
  if (value === null) return 4;
  if (typeof value === "string") return utf8ByteLength(JSON.stringify(value));
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Backup data contains a non-finite number.");
    return utf8ByteLength(JSON.stringify(value));
  }
  if (typeof value === "bigint") return utf8ByteLength(JSON.stringify(value.toString()));
  if (value instanceof Date) return utf8ByteLength(JSON.stringify(value.toISOString()));
  if (value instanceof Uint8Array) {
    let length = '{"bytes":[]}'.length;
    for (let index = 0; index < value.length; index += 1) {
      length += String(value[index]!).length + (index === 0 ? 0 : 1);
    }
    return length;
  }
  if (Array.isArray(value)) {
    return 2 + value.reduce((length, entry, index) => (
      length + encodedByteLength(entry) + (index === 0 ? 0 : 1)
    ), 0);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return 2 + keys.reduce((length, key, index) => {
      if (record[key] === undefined) throw new Error(`Backup data field ${key} is undefined.`);
      return length
        + utf8ByteLength(JSON.stringify(key))
        + 1
        + encodedByteLength(record[key])
        + (index === 0 ? 0 : 1);
    }, 0);
  }
  throw new Error(`Backup data contains unsupported value type ${typeof value}.`);
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index)!;
    if (codePoint <= 0x7f) length += 1;
    else if (codePoint <= 0x7ff) length += 2;
    else if (codePoint <= 0xffff) length += 3;
    else {
      length += 4;
      index += 1;
    }
  }
  return length;
}
