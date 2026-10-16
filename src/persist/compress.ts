/**
 * Compression utilities using standard Web Streams CompressionStream and DecompressionStream.
 * Supported in modern browsers, Node 22 (CI), and Node 24.
 */

export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  await writer.write(data as unknown as BufferSource);
  await writer.close();
  const buffer = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  await writer.write(data as unknown as BufferSource);
  await writer.close();
  const buffer = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(buffer);
}
