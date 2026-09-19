/**
 * Where a browser fetches an uploaded file. Files are stored as `/uploads/<name>`, which no
 * route serves: the API serves them at `/api/v1/media/uploads/<name>`, the path the web app's
 * proxy (and the VPS) forward to the API. Paths already in that form pass through.
 */
export const MEDIA_ROUTE = '/api/v1/media/uploads/';

export function assetUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  if (filePath.startsWith(MEDIA_ROUTE) || /^https?:\/\//.test(filePath)) return filePath;
  return `${MEDIA_ROUTE}${filePath.split('/').pop()}`;
}
