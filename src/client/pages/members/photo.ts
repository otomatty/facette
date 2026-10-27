/** 画像を中央で正方形に切り抜き、指定サイズの JPEG にする */
export async function resizeImage(file: File, size = 480): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const s = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を変換できませんでした");
  ctx.drawImage(bitmap, (bitmap.width - s) / 2, (bitmap.height - s) / 2, s, s, 0, 0, size, size);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("画像を変換できませんでした"))),
      "image/jpeg",
      0.86,
    ),
  );
}
