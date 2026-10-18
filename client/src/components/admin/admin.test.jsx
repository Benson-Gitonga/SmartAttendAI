import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminToday from './AdminToday';
import AdminClasses from './AdminClasses';
import AdminClassPage from './AdminClassPage';
import AdminTeachers from './AdminTeachers';
import * as api from '../../services/adminService';
import { todayISO } from '../../db/database';

jest.mock('../../services/adminService', () => ({
  getRegisterBoard: jest.fn(),
  getSchoolClasses: jest.fn(),
  getTeachers: jest.fn(),
  createClass: jest.fn(),
  updateClass: jest.fn(),
  getClassRegister: jest.fn(),
  saveClassRegister: jest.fn(),
}));
jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'admin@kibera.ac.ke', schoolId: 'school-1', role: 'admin' } }),
}));

jest.setTimeout(20_000);

const OTIENO = { userId: 'user-otieno', fullName: 'Ms. Otieno', email: 'otieno@kibera.ac.ke', status: 'active', classes: [{ classGroupId: 'class-3b', grade: 'Form 3', stream: 'B' }] };
const WANJIKU = { userId: 'user-wanjiku', fullName: 'Mrs. Wanjiku', email: 'wanjiku@kibera.ac.ke', status: 'active', classes: [] };

beforeEach(() => {
  sessionStorage.clear();
  api.getTeachers.mockResolvedValue([OTIENO, WANJIKU]);
});

describe('AdminToday', () => {
  const board = {
    date: todayISO(),
    totals: { classes: 3, done: 1, waiting: 2, students: 90, present: 50, late: 2, absent: 3, unmarked: 35, attendanceRate: 0.95 },
    classes: [
      { classGroupId: 'class-1a', grade: 'Form 1', stream: 'A', teacherName: 'Mr. Kamau', studentCount: 30, unmarked: 30, absent: 0, status: 'not_taken' },
      { classGroupId: 'class-3b', grade: 'Form 3', stream: 'B', teacherName: 'Ms. Otieno', studentCount: 30, unmarked: 0, absent: 3, status: 'done', lastMarkAt: new Date().toISOString() },
      { classGroupId: 'class-4c', grade: 'Form 4', stream: 'C', teacherName: null, studentCount: 30, unmarked: 5, absent: 0, status: 'gate_only' },
    ],
  };

  it('opens on the classes that still need their register', async () => {
    api.getRegisterBoard.mockResolvedValue(board);
    render(<AdminToday onOpenClass={jest.fn()} />);
    expect(await screen.findByText('Form 1 A')).toBeInTheDocument();
    expect(screen.getByText('Form 4 C')).toBeInTheDocument();
    expect(screen.queryByText('Form 3 B')).not.toBeInTheDocument();
    expect(screen.getByText('No teacher assigned')).toBeInTheDocument();
    expect(screen.getByText('Not taken')).toBeInTheDocument();
    expect(screen.getByText('classes done')).toBeInTheDocument();
  });

  it('opens a class to take its register', async () => {
    const user = userEvent.setup();
    const onOpenClass = jest.fn();
    api.getRegisterBoard.mockResolvedValue(board);
    render(<AdminToday onOpenClass={onOpenClass} />);
    await user.click(await screen.findByRole('button', { name: /Form 1 A/ }));
    expect(onOpenClass).toHaveBeenCalledWith('class-1a');
  });

  it('shows every class once all registers are done', async () => {
    api.getRegisterBoard.mockResolvedValue({ ...board, classes: [board.classes[1]] });
    render(<AdminToday onOpenClass={jest.fn()} />);
    expect(await screen.findByText('Form 3 B')).toBeInTheDocument();
  });
});

describe('AdminClasses', () => {
  const classes = [
    { classGroupId: 'class-3b', grade: 'Form 3', stream: 'B', academicYear: 2026, studentCount: 10, teacherUserId: 'user-otieno', teacherName: 'Ms. Otieno' },
    { classGroupId: 'class-4b', grade: 'Form 4', stream: 'B', academicYear: 2026, studentCount: 0, teacherUserId: null, teacherName: null },
  ];

  it('assigns a teacher to a class', async () => {
    const user = userEvent.setup();
    api.getSchoolClasses.mockResolvedValue(classes);
    api.updateClass.mockResolvedValue({ ...classes[1], teacherUserId: 'user-wanjiku', teacherName: 'Mrs. Wanjiku' });
    render(<AdminClasses onOpenClass={jest.fn()} />);
    await user.selectOptions(await screen.findByLabelText('Teacher for Form 4 B'), 'user-wanjiku');
    expect(api.updateClass).toHaveBeenCalledWith('class-4b', { teacherUserId: 'user-wanjiku' });
  });

  it('creates a class with its teacher', async () => {
    const user = userEvent.setup();
    api.getSchoolClasses.mockResolvedValue(classes);
    api.createClass.mockResolvedValue({ classGroupId: 'class-new', grade: 'Form 1', stream: 'North' });
    render(<AdminClasses onOpenClass={jest.fn()} />);
    await user.click(await screen.findByRole('button', { name: '+ New class' }));

    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Stream/), 'North');
    await user.selectOptions(within(dialog).getByLabelText('Class teacher'), 'user-wanjiku');
    await user.click(within(dialog).getByRole('button', { name: 'Create class' }));

    expect(api.createClass).toHaveBeenCalledWith('school-1', { grade: 'Form 1', stream: 'North', teacherUserId: 'user-wanjiku' });
  });
});

describe('AdminClassPage, taking or correcting a register', () => {
  const register = (overrides = {}) => ({
    date: todayISO(),
    class: { classGroupId: 'class-3b', grade: 'Form 3', stream: 'B', teacherName: 'Ms. Otieno', teacherUserId: 'user-otieno' },
    students: [
      { studentId: 'stu-1', fullName: 'Amina Wanjiru', admissionNo: '3B/001', mark: { status: 'present', captureMethod: 'rfid', createdAt: new Date().toISOString() }, override: null },
      { studentId: 'stu-2', fullName: 'Brian Kamau', admissionNo: '3B/002', mark: null, override: null },
      { studentId: 'stu-3', fullName: 'Chebet Rono', admissionNo: '3B/003', mark: null, override: null },
    ],
    ...overrides,
  });

  it('marks students and saves with a reason', async () => {
    const user = userEvent.setup();
    api.getClassRegister.mockResolvedValue(register());
    api.saveClassRegister.mockResolvedValue({ changed: ['stu-2', 'stu-3'], unchanged: [] });
    render(<AdminClassPage classGroupId="class-3b" />);

    await user.click(await screen.findByRole('button', { name: 'Absent: Brian Kamau' }));
    await user.selectOptions(screen.getByLabelText('Why Brian Kamau is absent'), 'health');
    await user.click(screen.getByRole('button', { name: /Mark the rest present/ }));
    expect(screen.getByText(/2 changes/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = screen.getByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    await user.click(within(dialog).getByLabelText('The class teacher is away'));
    await user.type(within(dialog).getByLabelText(/Note/), 'At a workshop');
    await user.click(save);

    expect(api.saveClassRegister).toHaveBeenCalledWith('class-3b', {
      date: todayISO(),
      reason: 'teacher_absent',
      note: 'At a workshop',
      marks: [
        { studentId: 'stu-2', status: 'absent', absenceReason: 'health' },
        { studentId: 'stu-3', status: 'present' },
      ],
    });
  });

  it('"Something else" needs a note before it can save', async () => {
    const user = userEvent.setup();
    api.getClassRegister.mockResolvedValue(register());
    render(<AdminClassPage classGroupId="class-3b" />);
    await user.click(await screen.findByRole('button', { name: 'Late: Amina Wanjiru' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByLabelText(/Something else/));
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Note/), 'Sports day');
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('shows where each mark came from, including earlier corrections', async () => {
    api.getClassRegister.mockResolvedValue(register({
      students: [
        { studentId: 'stu-1', fullName: 'Amina Wanjiru', admissionNo: '3B/001', mark: { status: 'present', captureMethod: 'manual', createdAt: new Date().toISOString() }, override: { actor: 'admin@kibera.ac.ke', reason: 'wrong_mark' } },
        { studentId: 'stu-2', fullName: 'Brian Kamau', admissionNo: '3B/002', mark: { status: 'present', captureMethod: 'rfid', createdAt: new Date().toISOString() }, override: null },
        { studentId: 'stu-3', fullName: 'Chebet Rono', admissionNo: '3B/003', mark: null, override: null },
      ],
    }));
    render(<AdminClassPage classGroupId="class-3b" />);
    expect(await screen.findByText('Changed by you')).toBeInTheDocument();
    expect(screen.getByText(/^Gate/)).toBeInTheDocument();
    expect(screen.getByText('not marked')).toBeInTheDocument();
  });

  it('putting a mark back as it was means nothing to save', async () => {
    const user = userEvent.setup();
    api.getClassRegister.mockResolvedValue(register());
    render(<AdminClassPage classGroupId="class-3b" />);
    await user.click(await screen.findByRole('button', { name: 'Absent: Amina Wanjiru' }));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Present: Amina Wanjiru' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument());
  });

  it('changes the class teacher from the class page', async () => {
    const user = userEvent.setup();
    api.getClassRegister.mockResolvedValue(register());
    api.updateClass.mockResolvedValue({ grade: 'Form 3', stream: 'B', teacherName: 'Mrs. Wanjiku' });
    render(<AdminClassPage classGroupId="class-3b" />);
    await user.selectOptions(await screen.findByLabelText('Class teacher'), 'user-wanjiku');
    expect(api.updateClass).toHaveBeenCalledWith('class-3b', { teacherUserId: 'user-wanjiku' });
  });
});

describe('AdminTeachers', () => {
  it('lists teachers with the classes they teach', async () => {
    const user = userEvent.setup();
    const onOpenClass = jest.fn();
    render(<AdminTeachers onOpenClass={onOpenClass} />);
    expect(await screen.findByText('Ms. Otieno')).toBeInTheDocument();
    expect(screen.getByText(/No classes yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Form 3 B' }));
    expect(onOpenClass).toHaveBeenCalledWith('class-3b');
  });
});
