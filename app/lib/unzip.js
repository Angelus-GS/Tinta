// Lector ZIP mínimo para paquetes .aix (stored + deflate vía DecompressionStream).
// Los .aix usan rutas con '/' y todo el contenido vive en Payload/.

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Buscar End Of Central Directory (firma 0x06054b50) desde el final
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP inválido: no se encontró el directorio central');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    // Cabecera local: saltar nombre/extra locales para llegar a los datos
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (!name.endsWith('/')) {
      files.set(name, method === 0 ? raw.slice() : await inflateRaw(raw));
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// Extrae las piezas de un .aix; acepta Payload/ (canónico) y res/ (respaldo).
export async function extractAix(bytes) {
  const files = await unzip(bytes);
  const pick = (name) => files.get(`Payload/${name}`) ?? files.get(`res/${name}`) ?? null;
  const wasm = pick('main.wasm');
  const sourceJson = pick('source.json');
  if (!wasm || !sourceJson) throw new Error('.aix inválido: faltan main.wasm o source.json');
  const parse = (b) => (b ? JSON.parse(new TextDecoder().decode(b)) : null);
  return {
    wasm,
    source: parse(sourceJson),
    filters: parse(pick('filters.json')),
    settings: parse(pick('settings.json')),
    icon: pick('icon.png'),
  };
}
