import { act, render, screen } from '@testing-library/react';
import CameraScanner from './CameraScanner';

let decoded;
jest.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    decodeFromConstraints(constraints, video, callback) {
      decoded = callback;
      return Promise.resolve({ stop: jest.fn() });
    }
  },
}));

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

  it('counts a card held in view only once', async () => {
    const onCode = jest.fn();
    render(<CameraScanner onCode={onCode} onClose={() => {}} />);
    await started();
    await read('ac221f07');
    await read('ac221f07');
    await read('BC331F08');
    expect(onCode.mock.calls).toEqual([['AC221F07'], ['BC331F08']]);
  });
});
