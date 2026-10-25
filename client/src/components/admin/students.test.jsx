import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminStudents from './AdminStudents';
import * as api from '../../services/adminService';

jest.mock('../../services/adminService', () => ({
  getStudents: jest.fn(),
  getSchoolClasses: jest.fn(),
  enrolStudent: jest.fn(),
  importStudents: jest.fn(),
  updateStudent: jest.fn(),
  reissueCard: jest.fn(),
}));
jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'admin@moigirls.ac.ke', schoolId: 'school-1', schoolName: 'Moi Girls', role: 'admin' } }),
}));

jest.setTimeout(20_000);

const CLASSES = [
  { classGroupId: 'class-1', grade: 'Form 1', stream: 'East', studentCount: 2 },
  { classGroupId: 'class-2', grade: 'Form 2', stream: null, studentCount: 0 },
];
const AMINA = { studentId: 'stu-1', fullName: 'Amina Hassan', admissionNo: 'MG/001', classGroupId: 'class-1', className: 'Form 1 East', cardUid: 'AC221F07', guardianPhone: '0712345678', active: true };
const BRENDA = { studentId: 'stu-2', fullName: 'Brenda Wanjiru', admissionNo: 'MG/002', classGroupId: 'class-1', className: 'Form 1 East', cardUid: 'E405102D', active: true };
const OLD = { studentId: 'stu-3', fullName: 'Old Student', admissionNo: 'MG/000', classGroupId: 'class-1', className: 'Form 1 East', cardUid: null, active: false };

beforeEach(() => {
  api.getSchoolClasses.mockResolvedValue(CLASSES);
  api.getStudents.mockResolvedValue([AMINA, BRENDA, OLD]);
});

describe('AdminStudents', () => {
  it('lists enrolled students with their card numbers, removed ones only on request', async () => {
    const user = userEvent.setup();
    render(<AdminStudents onPrintCards={jest.fn()} />);
    expect(await screen.findByText('Amina Hassan')).toBeInTheDocument();
    expect(screen.getByText('AC221F07')).toBeInTheDocument();
    expect(screen.queryByText('Old Student')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/Show removed/));
    expect(screen.getByText('Old Student')).toBeInTheDocument();
  });

  it('adds a student to the chosen class', async () => {
    const user = userEvent.setup();
    api.enrolStudent.mockResolvedValue({ ...AMINA, studentId: 'stu-9', fullName: 'Cynthia Achieng', cardUid: 'F03A1A21' });
    render(<AdminStudents onPrintCards={jest.fn()} />);
    await screen.findByText('Amina Hassan');
    await user.click(screen.getByRole('button', { name: 'Add student' }));
    const panel = screen.getByRole('complementary', { name: 'Add student' });
    await user.type(within(panel).getByLabelText('Full name'), 'Cynthia Achieng');
    await user.selectOptions(within(panel).getByLabelText('Class'), 'class-2');
    await user.type(within(panel).getByLabelText(/Guardian phone/), '0733 445 566');
    await user.click(within(panel).getByRole('button', { name: 'Add student' }));
    expect(api.enrolStudent).toHaveBeenCalledWith('class-2', expect.objectContaining({ fullName: 'Cynthia Achieng', guardianPhone: '0733445566' }));
  });

  it('checks the phone number before saving', async () => {
    const user = userEvent.setup();
    render(<AdminStudents onPrintCards={jest.fn()} />);
    await screen.findByText('Amina Hassan');
    await user.click(screen.getByRole('button', { name: 'Add student' }));
    const panel = screen.getByRole('complementary', { name: 'Add student' });
    await user.type(within(panel).getByLabelText('Full name'), 'Cynthia Achieng');
    await user.type(within(panel).getByLabelText(/Guardian phone/), '123');
    await user.click(within(panel).getByRole('button', { name: 'Add student' }));
    expect(within(panel).getByText(/Kenyan mobile number/)).toBeInTheDocument();
    expect(api.enrolStudent).not.toHaveBeenCalled();
  });

  it('moves a student by changing their class', async () => {
    const user = userEvent.setup();
    api.updateStudent.mockResolvedValue({ ...AMINA, classGroupId: 'class-2', className: 'Form 2' });
    render(<AdminStudents onPrintCards={jest.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Amina Hassan' }));
    const panel = screen.getByRole('complementary', { name: 'Amina Hassan' });
    await user.selectOptions(within(panel).getByLabelText('Class'), 'class-2');
    expect(within(panel).getByText(/Saving moves the student/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Save changes' }));
    expect(api.updateStudent).toHaveBeenCalledWith('stu-1', { classGroupId: 'class-2' });
  });

  it('asks before removing a student', async () => {
    const user = userEvent.setup();
    api.updateStudent.mockResolvedValue({ ...AMINA, active: false });
    render(<AdminStudents onPrintCards={jest.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Amina Hassan' }));
    await user.click(screen.getByRole('button', { name: 'Remove student' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Remove Amina Hassan?');
    expect(api.updateStudent).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(api.updateStudent).toHaveBeenCalledWith('stu-1', { active: false });
  });

  it('prints ID cards for the students shown', async () => {
    const user = userEvent.setup();
    const onPrintCards = jest.fn();
    render(<AdminStudents onPrintCards={onPrintCards} />);
    await screen.findByText('Amina Hassan');
    await user.selectOptions(screen.getByLabelText('Class'), 'class-1');
    await user.click(screen.getByRole('button', { name: /Print ID cards/ }));
    expect(onPrintCards).toHaveBeenCalledWith([AMINA, BRENDA], 'ID cards: Form 1 East');
  });

  it('imports a CSV class list', async () => {
    const user = userEvent.setup();
    api.importStudents.mockResolvedValue([AMINA, BRENDA]);
    render(<AdminStudents onPrintCards={jest.fn()} />);
    await screen.findByText('Amina Hassan');
    await user.click(screen.getByRole('button', { name: 'Import from CSV' }));
    const dialog = screen.getByRole('dialog');
    const file = new File(['Name,Admission No\nAmina Hassan,MG/001\nBrenda Wanjiru,MG/002\n'], 'form1.csv', { type: 'text/csv' });
    await user.upload(within(dialog).getByLabelText('CSV file'), file);
    expect(await within(dialog).findByText(/2 students found in form1.csv/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 students' }));
    expect(api.importStudents).toHaveBeenCalledWith('class-1', [
      { fullName: 'Amina Hassan', admissionNo: 'MG/001' },
      { fullName: 'Brenda Wanjiru', admissionNo: 'MG/002' },
    ]);
  });
});
