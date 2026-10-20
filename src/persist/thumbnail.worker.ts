const worker = self as unknown as {
  onmessage: ((event: MessageEvent<ImageBitmap>) => void) | null;
  postMessage(message: { blob?: Blob; error?: string }): void;
};

worker.onmessage = async ({ data: bitmap }) => {
  try {
    const canvas = new OffscreenCanvas(160, 90);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D thumbnail canvas is unavailable');
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, 160, 90);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    worker.postMessage({ blob });
  } catch (error) {
    worker.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    bitmap.close();
  }
};
