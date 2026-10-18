// Shrinks a chosen picture to a square profile picture in the browser, so a 12 MB phone photo becomes a few tens of KB
// before it is sent: centred crop, 256 px, WebP (JPEG where the browser cannot write WebP).

const SIZE = 256;
const MAX_INPUT = 20 * 1024 * 1024;

export async function squareAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > MAX_INPUT) throw new Error("That image is larger than 20 MB.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That image could not be read. Try a PNG, JPEG or WebP.");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("This browser cannot resize images.");
  g.imageSmoothingQuality = "high";
  g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  const blob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  const out = (await blob("image/webp")) ?? (await blob("image/jpeg"));
  if (!out || (out.type !== "image/webp" && out.type !== "image/jpeg")) throw new Error("This browser cannot resize images.");
  return out;
}
