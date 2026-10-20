/**
 * Compression utilities using standard Web Streams CompressionStream and DecompressionStream.
 * Supported in modern browsers, Node 22 (CI), and Node 24.
 */

/**
 * Pipes the bytes through the stream and reads the result concurrently. Writing everything before
 * reading anything can stall in browsers: the transform applies backpressure until its output is read.
 */
async function pipe(
  data: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const buffer = await new Response(
    source.pipeThrough(transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>),
  ).arrayBuffer();
  return new Uint8Array(buffer);
}

export function deflate(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new CompressionStream('deflate'));
}

export function inflate(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new DecompressionStream('deflate'));
}
