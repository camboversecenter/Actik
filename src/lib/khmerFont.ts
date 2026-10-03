// Noto Sans Khmer, shipped with the app rather than fetched from a font CDN.
//
// A printed certificate's holder name is compared, letter for letter, with the
// name signed into its QR code. Rendered in a fallback font without Khmer
// shaping, the subscripts come apart and the paper no longer reads as the
// name that was signed. Bundled, the font is also precached by the service
// worker, so printing and scanning work offline.
//
// Imported by whatever renders Khmer that matters — the app entry, and the
// printable certificate itself, so the certificate never depends on being
// rendered from inside the app shell.
import '@fontsource/noto-sans-khmer/khmer-400.css'
import '@fontsource/noto-sans-khmer/khmer-600.css'
import '@fontsource/noto-sans-khmer/khmer-700.css'

export const KHMER_FONT_FAMILY = 'Noto Sans Khmer'

/**
 * Resolve once the Khmer faces needed for `text` are loaded. With
 * font-display: swap a page can paint — and print — in a fallback first.
 */
export async function khmerFontReady(text: string): Promise<void> {
  try {
    await Promise.all(
      ['400', '600', '700'].map((w) => document.fonts.load(`${w} 1em "${KHMER_FONT_FAMILY}"`, text))
    )
    await document.fonts.ready
  } catch {
    /* no FontFace API: the browser will do what it can */
  }
}
