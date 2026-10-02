/** Edge length of a stored game cover. The storefront frame is 60px, so this keeps it sharp on 3x screens. */
const COVER_SIZE = 256;

/**
 * Crop to the centre square and scale to `COVER_SIZE`, so any upload fits the
 * storefront's square frame without distorting it. Done in the browser: the
 * panel then ships a few kilobytes instead of whatever the operator picked.
 */
export async function toSquareCover(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = COVER_SIZE;
    canvas.height = COVER_SIZE;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("canvas unavailable");
    context.imageSmoothingQuality = "high";
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      COVER_SIZE,
      COVER_SIZE,
    );
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    if (blob === null) throw new Error("encode failed");
    /* Safari cannot encode WebP and silently returns PNG; trust the blob's type. */
    const extension = blob.type === "image/png" ? "png" : "webp";
    return new File([blob], `cover.${extension}`, { type: blob.type });
  } finally {
    bitmap.close();
  }
}
