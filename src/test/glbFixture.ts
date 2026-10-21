/** A valid, self-contained GLB for transport/cache tests (no network or assets). */
export function makeGlb(json: object = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [] }] }): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(bytes.length / 4) * 4;
  const buffer = new ArrayBuffer(20 + jsonLength);
  const header = new DataView(buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, buffer.byteLength, true);
  header.setUint32(12, jsonLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20).fill(32);
  new Uint8Array(buffer, 20).set(bytes);
  return buffer;
}
