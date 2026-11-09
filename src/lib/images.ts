// Shrink phone photos before uploading them. Drawing through an <img> also turns iPhone HEIC photos into
// JPEG and applies the camera's rotation.

/** Claude scales recipe photos larger than about 1568px down anyway, so sending more only costs time. */
const RECIPE_EDGE = 1568;
/** A dish photo: sharp on a phone held sideways, about 200 KB. */
const DISH_EDGE = 1600;
/** The recipe box card: two columns on a 3x screen. */
const THUMB_EDGE = 640;

export interface PreparedImage {
  data: string; // base64, no data: prefix
  mediaType: "image/jpeg";
  preview: string; // object URL for a thumbnail
}

const failed = () => new Error("This phone couldn't prepare the photo.");

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file isn't a photo this phone can open."));
    img.src = src;
  });
}

/** The image scaled to fit `maxEdge`, as base64 JPEG. */
async function encode(img: HTMLImageElement, maxEdge: number, quality: number): Promise<string> {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw failed();
  ctx.fillStyle = "#fff"; // transparent PNGs would otherwise turn black in a JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  if (!blob) throw failed();
  return new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
    fr.onerror = () => reject(failed());
    fr.readAsDataURL(blob);
  });
}

/** A photo of a recipe page, for reading. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const preview = URL.createObjectURL(file);
  const img = await load(preview);
  return { data: await encode(img, RECIPE_EDGE, 0.85), mediaType: "image/jpeg", preview };
}

/** A photo of the finished dish: one to show on the recipe, and a small one for the recipe box. */
export async function prepareDishPhoto(file: File): Promise<{ full: string; thumb: string }> {
  const src = URL.createObjectURL(file);
  try {
    const img = await load(src);
    return { full: await encode(img, DISH_EDGE, 0.82), thumb: await encode(img, THUMB_EDGE, 0.78) };
  } finally {
    URL.revokeObjectURL(src);
  }
}
