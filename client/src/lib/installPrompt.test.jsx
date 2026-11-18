import { act, render, screen } from '@testing-library/react';
import { listenForInstallPrompt, useInstallPrompt } from './installPrompt';

function Probe() {
  const { mode, install } = useInstallPrompt();
  return <button type="button" onClick={install}>{mode ?? 'none'}</button>;
}

listenForInstallPrompt();

function firePrompt(outcome = 'accepted') {
  const event = new Event('beforeinstallprompt');
  event.prompt = jest.fn();
  event.userChoice = Promise.resolve({ outcome });
  act(() => { window.dispatchEvent(event); });
  return event;
}

test('offers nothing until the browser says the app can be installed', () => {
  render(<Probe />);
  expect(screen.getByRole('button')).toHaveTextContent('none');
});

test('shows the prompt when asked, then hides the button', async () => {
  render(<Probe />);
  const event = firePrompt();
  expect(screen.getByRole('button')).toHaveTextContent('prompt');
  await act(async () => { screen.getByRole('button').click(); });
  expect(event.prompt).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button')).toHaveTextContent('none');
});
