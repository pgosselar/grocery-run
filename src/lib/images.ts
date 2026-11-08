// Shrink a phone photo before uploading it for reading. Claude scales anything larger than about 1568px
// down anyway, so sending more only costs upload time. Drawing through an <img> also turns iPhone HEIC
// photos into JPEG and applies the camera's rotation.

const MAX_EDGE = 1568;

export interface PreparedImage {
  data: string; // base64, no data: prefix
  mediaType: "image/jpeg";
  preview: string; // object URL for a thumbnail
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file isn't a photo this phone can open."));
    img.src = src;
  });
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const preview = URL.createObjectURL(file);
  const img = await load(preview);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This phone couldn't prepare the photo.");
  ctx.fillStyle = "#fff"; // transparent PNGs would otherwise turn black in a JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("This phone couldn't prepare the photo.");
  const data = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
    fr.onerror = () => reject(new Error("This phone couldn't prepare the photo."));
    fr.readAsDataURL(blob);
  });
  return { data, mediaType: "image/jpeg", preview };
}
