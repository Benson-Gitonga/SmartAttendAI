import { encodeCode128B, code128BSymbols } from './code128';

const modules = (text) => {
  const { bars, width } = encodeCode128B(text);
  return { bars, width };
};

describe('encodeCode128B', () => {
  it('is 11 modules per symbol plus the 13-module stop and two 10-module quiet zones', () => {
    // start + 8 data + checksum = 10 symbols of 11, stop 13, quiet 2 x 10
    expect(modules('7F3A9C21').width).toBe(10 * 11 + 13 + 20);
  });

  it('starts with the Start B pattern (2-1-1-2-1-4) after the quiet zone', () => {
    const { bars } = modules('A');
    expect(bars[0]).toEqual({ x: 10, w: 2 });
    expect(bars[1]).toEqual({ x: 13, w: 1 });
    expect(bars[2]).toEqual({ x: 16, w: 1 });
  });

  it('weights each character by its position in the checksum', () => {
    // 104 + P(48)*1 + J(42)*2 + J(42)*3 + 1(17)*4 + 2(18)*5 + 3(19)*6 + C(35)*7 = 879; 879 % 103 = 55
    const symbols = code128BSymbols('PJJ123C');
    expect(symbols[0]).toBe(104);
    expect(symbols.at(-2)).toBe(55);
    expect(symbols.at(-1)).toBe(106);
  });

  it('refuses characters outside printable ASCII', () => {
    expect(() => encodeCode128B('é')).toThrow();
  });
});

describe('a real scanner can read it', () => {
  // Draw the bars into a grey-scale image and decode it with ZXing, the same
  // library the camera scanner uses.
  const { MultiFormatReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource, DecodeHintType, BarcodeFormat } = require('@zxing/library');

  function decode(text) {
    const { bars, width } = encodeCode128B(text);
    const scale = 3;
    const w = width * scale;
    const h = 60;
    const pixels = new Uint8ClampedArray(w * h).fill(255);
    for (const bar of bars) {
      for (let y = 0; y < h; y += 1) {
        for (let x = bar.x * scale; x < (bar.x + bar.w) * scale; x += 1) pixels[y * w + x] = 0;
      }
    }
    const reader = new MultiFormatReader();
    reader.setHints(new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]]]));
    return reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, w, h)))).getText();
  }

  it.each(['7F3A9C21', '00000000', 'ABCDEF12', 'KB-001'])('decodes %s', (text) => {
    expect(decode(text)).toBe(text);
  });
});
