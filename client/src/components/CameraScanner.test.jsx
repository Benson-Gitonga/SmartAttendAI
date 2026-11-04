import { act, render, screen } from '@testing-library/react';
import CameraScanner from './CameraScanner';

let decoded;
let zxingHints;
jest.mock('@zxing/browser', () => ({
  BarcodeFormat: { QR_CODE: 'QR_CODE', CODE_128: 'CODE_128' },
  BrowserMultiFormatReader: class {
    constructor(hints) { zxingHints = hints; }

    decodeFromStream(stream, video, callback) {
      decoded = callback;
      return Promise.resolve({ stop: jest.fn() });
    }
  },
}));
jest.mock('@zxing/library', () => ({ DecodeHintType: { POSSIBLE_FORMATS: 'POSSIBLE_FORMATS' } }));

const track = { stop: jest.fn(), getCapabilities: () => ({}), applyConstraints: jest.fn(() => Promise.resolve()) };
const stream = { getVideoTracks: () => [track], getTracks: () => [track] };

beforeEach(() => {
  decoded = undefined;
  zxingHints = undefined;
  track.stop.mockClear();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: jest.fn(() => Promise.resolve(stream)) },
  });
  delete window.BarcodeDetector;
});

const started = () => screen.findByText('Ready for the next card');
const read = (text) => act(async () => decoded({ getText: () => text }));

describe('CameraScanner', () => {
  it('shows the result of a scan large, then gets ready for the next card', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    const feedback = { id: 1, tone: 'ok', title: 'Amina Hassan', text: 'Marked present' };
    render(<CameraScanner onCode={() => {}} onClose={() => {}} feedback={feedback} progress="3 of 28 scanned" />);

    expect(screen.getByRole('status')).toHaveTextContent('Amina Hassan');
    expect(screen.getByRole('status')).toHaveTextContent('Marked present');
    expect(screen.getByText('3 of 28 scanned')).toBeInTheDocument();

    await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('status')).not.toHaveTextContent('Amina Hassan');
    jest.useRealTimers();
  });

  it('asks for a sharp back camera and reads only the card formats', async () => {
    render(<CameraScanner onCode={() => {}} onClose={() => {}} />);
    await started();
    const { video } = navigator.mediaDevices.getUserMedia.mock.calls[0][0];
    expect(video.facingMode).toEqual({ ideal: 'environment' });
    expect(video.width).toEqual({ ideal: 1280 });
    expect(zxingHints.get('POSSIBLE_FORMATS')).toEqual(['QR_CODE', 'CODE_128']);
  });

  it('counts a card held in view only once', async () => {
    const onCode = jest.fn();
    render(<CameraScanner onCode={onCode} onClose={() => {}} />);
    await started();
    await read('ac221f07');
    await read('ac221f07');
    await read('BC331F08');
    expect(onCode.mock.calls).toEqual([['AC221F07'], ['BC331F08']]);
  });

  it('uses the phone’s built-in barcode reader when there is one', async () => {
    const detect = jest.fn(() => Promise.resolve([{ rawValue: 'ac221f07' }]));
    window.BarcodeDetector = class {
      static getSupportedFormats() { return Promise.resolve(['qr_code', 'code_128', 'ean_13']); }

      detect(...args) { return detect(...args); }
    };
    jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });

    const onCode = jest.fn();
    const { unmount } = render(<CameraScanner onCode={onCode} onClose={() => {}} />);
    await started();
    await act(async () => { await new Promise((r) => { setTimeout(r, 50); }); });

    expect(onCode).toHaveBeenCalledWith('AC221F07');
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(zxingHints).toBeUndefined();
    unmount();
    expect(track.stop).toHaveBeenCalled();
    delete HTMLMediaElement.prototype.readyState;
  });

  it('turns the camera off when closed', async () => {
    const { unmount } = render(<CameraScanner onCode={() => {}} onClose={() => {}} />);
    await started();
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });
});
