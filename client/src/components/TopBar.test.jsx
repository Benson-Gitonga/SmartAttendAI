import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TopBar from './TopBar';

jest.mock('./ThemeToggle', () => () => null);

const crumbs = [{ label: 'Form 3 B' }, { label: 'Take Attendance' }];

describe('TopBar records waiting to send', () => {
  it('shows nothing when every record has reached the server', () => {
    render(<TopBar crumbs={crumbs} online pending={0} onAccount={() => {}} />);
    expect(screen.queryByRole('button', { name: /waiting to send/ })).not.toBeInTheDocument();
  });

  it('shows how many are waiting and opens the account sheet', async () => {
    const onAccount = jest.fn();
    render(<TopBar crumbs={crumbs} online={false} pending={12} onAccount={onAccount} />);
    const chip = screen.getByRole('button', { name: '12 attendance records waiting to send' });
    expect(chip).toHaveTextContent('12');
    expect(chip).toHaveAttribute('title', expect.stringContaining('send when you are back online'));
    expect(chip).toHaveClass('pending-chip--offline');

    await userEvent.setup().click(chip);
    expect(onAccount).toHaveBeenCalled();
  });

  it('says it is sending while online', () => {
    render(<TopBar crumbs={crumbs} online pending={1} onAccount={() => {}} />);
    const chip = screen.getByRole('button', { name: '1 attendance record waiting to send' });
    expect(chip).toHaveAttribute('title', 'Sending 1 record to the school…');
    expect(chip).not.toHaveClass('pending-chip--offline');
  });
});
