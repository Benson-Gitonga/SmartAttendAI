/**
 * Code 128 (set B) barcodes for student ID cards. Set B covers printable
 * ASCII, which is all a card number needs. Returns the bar widths so the card
 * can draw them as SVG rectangles; no library, so cards print offline.
 *
 * Each symbol is 6 alternating bar/space widths (11 modules); the stop symbol
 * has 7 (13 modules). The checksum is the start value plus each data value
 * times its position, mod 103.
 */

// Widths for values 0-106 (106 = stop), bar first.
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

/** The symbol values: Start B, the text, the checksum and Stop. */
export function code128BSymbols(text) {
  const values = [...String(text)].map((ch) => {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error(`Code 128B cannot encode ${JSON.stringify(ch)}`);
    return code - 32;
  });
  const checksum = values.reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103;
  return [START_B, ...values, checksum, STOP];
}

/**
 * @param {string} text printable ASCII (32-126)
 * @returns {{ bars: {x: number, w: number}[], width: number }} in modules, quiet zones included
 */
export function encodeCode128B(text) {
  const symbols = code128BSymbols(text);

  const QUIET = 10;
  const bars = [];
  let x = QUIET;
  for (const symbol of symbols) {
    [...PATTERNS[symbol]].forEach((digit, i) => {
      const w = Number(digit);
      if (i % 2 === 0) bars.push({ x, w });
      x += w;
    });
  }
  return { bars, width: x + QUIET };
}
