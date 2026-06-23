/**
 * Thai-safe line wrapping for thermal receipt renderers.
 *
 * Thai typography has "combining" characters — vowel signs, tone marks, and
 * diacritics — that visually modify the preceding consonant and must never
 * appear at the start of a wrapped line segment.  Breaking before them leaves
 * a detached mark that the printer renders as an isolated glyph:
 *
 *   BAD:  "จ.เชียงใ"  /  "หม่"
 *   GOOD: "จ.เชียงใหม่"
 *
 * All renderers (ESC/POS, bitmap, HTML) share a single wrap algorithm via the
 * measureFn abstraction so they produce identical line-break points.
 */

/** Thai diacritics, vowel signs, and tone marks that must not begin a new
 *  line segment (they combine visually with the preceding consonant). */
const THAI_COMBINING = new Set([
  'ั', // ั  mai han akat (sara a — above)
  'ิ', // ิ  sara i
  'ี', // ี  sara ii
  'ึ', // ึ  sara ue
  'ื', // ื  sara uee
  'ุ', // ุ  sara u
  'ู', // ู  sara uu
  'ฺ', // ฺ  phinthu (lower dot)
  '็', // ็  mai tai khu
  '่', // ่  mai ek
  '้', // ้  mai tho
  '๊', // ๊  mai tri
  '๋', // ๋  mai jattawa
  '์', // ์  thantakhat (silent mark)
  'ํ', // ํ  nikhahit
  '๎', // ๎  yamakkan
]);

/**
 * Character-by-character split with Thai combining-character safety.
 * Skips break points where the next character is a Thai combining mark.
 */
function charSplitSafe(
  word: string,
  maxWidth: number,
  measureFn: (s: string) => number,
): string[] {
  const segments: string[] = [];
  let cur = '';
  for (const ch of word) {
    const test = cur + ch;
    if (measureFn(test) > maxWidth && cur) {
      if (THAI_COMBINING.has(ch)) {
        // Combining char — must not start a new line; extend current segment
        cur = test;
      } else {
        segments.push(cur);
        cur = ch;
      }
    } else {
      cur = test;
    }
  }
  if (cur) segments.push(cur);
  return segments.length ? segments : [word];
}

/**
 * Word-aware, Thai-safe line wrap used by all thermal receipt renderers.
 *
 * Algorithm:
 *   1. Split at spaces (word-boundary first — avoids breaking Thai words).
 *   2. For individual words wider than maxWidth, use Thai-safe char splitting.
 *
 * measureFn must return values in the same units as maxWidth:
 *   - ESC/POS: (s) => s.length                       maxWidth = column count
 *   - bitmap:  (s) => ctx.measureText(s).width        maxWidth = pixels
 */
export function wrapTextSafe(
  text: string,
  maxWidth: number,
  measureFn: (s: string) => number,
): string[] {
  if (measureFn(text) <= maxWidth) return [text];

  const words = text.split(' ');
  const segments: string[] = [];
  let cur = '';

  for (const word of words) {
    if (!word) continue;
    const candidate = cur ? cur + ' ' + word : word;
    if (measureFn(candidate) <= maxWidth) {
      cur = candidate;
    } else {
      if (cur) segments.push(cur);
      if (measureFn(word) > maxWidth) {
        const parts = charSplitSafe(word, maxWidth, measureFn);
        segments.push(...parts.slice(0, -1));
        cur = parts[parts.length - 1] ?? '';
      } else {
        cur = word;
      }
    }
  }

  if (cur) segments.push(cur);
  return segments.length ? segments : [text];
}
