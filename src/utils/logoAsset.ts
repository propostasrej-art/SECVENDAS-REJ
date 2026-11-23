import type { jsPDF } from 'jspdf';

/**
 * Official R&J Imóveis logo asset path (168x168 square PNG).
 */
export const LOGO_RJ_PATH = '/assets/aistudio/LOGORJ_031e637a.png';

let cachedDataUrl: string | null = null;
let cachedBytes: Uint8Array | null = null;
let loadPromise: Promise<void> | null = null;

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Preloads the official R&J Imóveis PNG logo from `/assets/aistudio/LOGORJ_031e637a.png`
 * into memory as both Uint8Array (for DOCX) and Data URL (for synchronous jsPDF & offline HTML prints).
 */
export function preloadLogoRj(): Promise<void> {
  if (cachedDataUrl && cachedBytes) {
    return Promise.resolve();
  }
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    return Promise.resolve();
  }
  if (!loadPromise) {
    loadPromise = fetch(LOGO_RJ_PATH)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        cachedBytes = bytes;
        cachedDataUrl = `data:image/png;base64,${uint8ToBase64(bytes)}`;
      })
      .catch((err) => {
        console.warn('[logoAsset] Não foi possível pré-carregar o logo R&J:', err);
        loadPromise = null;
      });
  }
  return loadPromise;
}

// Start eager preload immediately in browser environments
if (typeof window !== 'undefined') {
  void preloadLogoRj();
}

/**
 * Returns the best `src` attribute for HTML print documents:
 * inline PNG Data URL once loaded (instant synchronous paint & works offline),
 * falling back directly to the local asset path `/assets/aistudio/LOGORJ_031e637a.png`.
 */
export function getLogoRjSrc(): string {
  return cachedDataUrl || LOGO_RJ_PATH;
}

export function getLogoRjDataUrlSync(): string | null {
  return cachedDataUrl;
}

export async function ensureLogoRjDataUrl(): Promise<string | null> {
  await preloadLogoRj();
  return cachedDataUrl;
}

export async function ensureLogoRjBytes(): Promise<Uint8Array | null> {
  await preloadLogoRj();
  return cachedBytes;
}

/**
 * Draws the official square R&J Imóveis PNG logo onto a jsPDF instance.
 * Returns true if the logo was drawn, false if not yet loaded.
 */
export function addLogoToJsPdf(
  doc: jsPDF,
  x: number,
  y: number,
  sizeMm: number
): boolean {
  if (!cachedDataUrl) return false;
  try {
    doc.addImage(cachedDataUrl, 'PNG', x, y, sizeMm, sizeMm);
    return true;
  } catch (err) {
    console.warn('[logoAsset] Falha ao inserir logo no PDF:', err);
    return false;
  }
}
