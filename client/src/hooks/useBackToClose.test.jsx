import { useState } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useBackToClose } from './useBackToClose';

function Sheet({ name, onClose }) {
  useBackToClose(onClose);
  return (
    <div role="dialog" aria-label={name}>
      <button type="button" onClick={onClose}>Close {name}</button>
    </div>
  );
}

function Page({ onPagePop }) {
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(false);
  // Something on the page that reacts to back, like the router.
  useState(() => window.addEventListener('popstate', onPagePop));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      {open && <Sheet name="outer" onClose={() => setOpen(false)} />}
      {open && <button type="button" onClick={() => setInner(true)}>Open inner</button>}
      {inner && <Sheet name="inner" onClose={() => setInner(false)} />}
    </>
  );
}

const back = () => act(async () => {
  window.history.back();
  await new Promise((r) => setTimeout(r, 30));
});

beforeEach(() => {
  window.history.replaceState(null, '', '/#/dashboard');
});

describe('useBackToClose', () => {
  it('back closes the open sheet and stays on the page', async () => {
    const user = userEvent.setup();
    const onPagePop = jest.fn();
    render(<Page onPagePop={onPagePop} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'outer' })).toBeInTheDocument();

    await back();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#/dashboard');
  });

  it('closing from the sheet removes its history entry without the page noticing', async () => {
    const user = userEvent.setup();
    const onPagePop = jest.fn();
    render(<Page onPagePop={onPagePop} />);
    const before = window.history.length;
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Close outer' }));
    await waitFor(() => expect(window.history.state?.overlay).toBeUndefined());
    await new Promise((r) => setTimeout(r, 30));
    expect(onPagePop).not.toHaveBeenCalled();
    expect(window.history.length).toBeGreaterThanOrEqual(before);
  });

  it('stacked sheets close one at a time, top first', async () => {
    const user = userEvent.setup();
    render(<Page onPagePop={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Open inner' }));
    expect(screen.getByRole('dialog', { name: 'inner' })).toBeInTheDocument();

    await back();
    expect(screen.queryByRole('dialog', { name: 'inner' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'outer' })).toBeInTheDocument();

    await back();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
