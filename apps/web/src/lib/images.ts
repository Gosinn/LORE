const MAX_EDGE = 2048;

/**
 * Shrinks photos before upload: phone pictures are huge, and redrawing them on a
 * canvas also strips EXIF metadata, so GPS coordinates never leave the device
 * unless someone deliberately adds a location. GIFs are passed through untouched.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; name: string }> {
  if (file.type === 'image/gif' || !file.type.startsWith('image/')) return { blob: file, name: file.name };
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) return { blob: file, name: file.name };
    return { blob, name: file.name.replace(/\.\w+$/, '') + '.jpg' };
  } catch {
    return { blob: file, name: file.name };
  }
}
