// Postcard (formato binario de serde) — encoder/decoder mínimo.
// Verificado byte-exacto contra salidas reales de fuentes Aidoku en Fase 0.

export function encVarint(n) {
  const out = [];
  let v = BigInt(n);
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return Uint8Array.from(out);
}

export function encString(s) {
  const b = new TextEncoder().encode(s);
  const head = encVarint(b.length);
  const out = new Uint8Array(head.length + b.length);
  out.set(head, 0);
  out.set(b, head.length);
  return out;
}

export function encZigzag(n) {
  const v = BigInt(n);
  return encVarint(v >= 0n ? v * 2n : -v * 2n - 1n);
}

export function encBool(b) {
  return Uint8Array.of(b ? 1 : 0);
}

export function encOpt(v, fn) {
  if (v === null || v === undefined) return Uint8Array.of(0);
  const inner = fn(v);
  const out = new Uint8Array(1 + inner.length);
  out[0] = 1;
  out.set(inner, 1);
  return out;
}

export function encVec(arr, fn) {
  const parts = [encVarint(arr.length)];
  for (const item of arr) parts.push(fn(item));
  return concat(parts);
}

export function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

export class Dec {
  constructor(buf) {
    this.buf = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    this.p = 0;
  }
  u8() { return this.buf[this.p++]; }
  varint() {
    let result = 0n, shift = 0n;
    for (;;) {
      const byte = this.buf[this.p++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) break;
      shift += 7n;
    }
    return result;
  }
  usize() { return Number(this.varint()); }
  i64() { const v = this.varint(); return Number((v >> 1n) ^ (-(v & 1n))); }
  f32() { const x = this.view.getFloat32(this.p, true); this.p += 4; return x; }
  bool() { return this.u8() !== 0; }
  string() {
    const n = this.usize();
    const s = new TextDecoder().decode(this.buf.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
  option(fn) { return this.u8() === 0 ? null : fn(this); }
  vec(fn) {
    const n = this.usize();
    const out = [];
    for (let i = 0; i < n; i++) out.push(fn(this));
    return out;
  }
}
