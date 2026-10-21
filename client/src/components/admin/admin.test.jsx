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
  inviteTeacher: jest.fn(),
  newTeacherCode: jest.fn(),
  setTeacherEnabled: jest.fn(),
}));
jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'admin@kibera.ac.ke', schoolId: 'school-1', schoolName: 'Kibera Secondary School', role: 'admin' } }),
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
      { classGroupId: 'class-1a', grade: 'Form 1', stream: 'A', teacherName: 'Mr. Kamau', teacherUserId: 'user-kamau', studentCount: 30, unmarked: 30, present: 0, late: 0, absent: 0, status: 'not_taken' },
      { classGroupId: 'class-3b', grade: 'Form 3', stream: 'B', teacherName: 'Ms. Otieno', teacherUserId: 'user-otieno', studentCount: 30, unmarked: 0, present: 27, late: 0, absent: 3, status: 'done', lastMarkAt: new Date().toISOString() },
      { classGroupId: 'class-4c', grade: 'Form 4', stream: 'C', teacherName: null, teacherUserId: null, studentCount: 30, unmarked: 5, present: 25, late: 0, absent: 0, status: 'gate_only' },
    ],
  };

  it('opens on the classes that still need their register', async () => {
    api.getRegisterBoard.mockResolvedValue(board);
    render(<AdminToday onOpenClass={jest.fn()} />);
    expect(await screen.findByText('Form 1 A')).toBeInTheDocument();
    expect(screen.getByText('Form 4 C')).toBeInTheDocument();
    expect(screen.queryByText('Form 3 B')).not.toBeInTheDocument();
    expect(screen.getByText('No teacher')).toBeInTheDocument();
    expect(screen.getByText('Not taken')).toBeInTheDocument();
    expect(screen.getByText('Registers taken')).toBeInTheDocument();
    // one class has no teacher, so the setup checklist still shows that step
    expect(screen.getByText('Give every class a teacher')).toBeInTheDocument();
  });

  it('opens a class to take its register', async () => {
    const user = userEvent.setup();
    const onOpenClass = jest.fn();
    api.getRegisterBoard.mockResolvedValue(board);
    render(<AdminToday onOpenClass={onOpenClass} />);
    await user.click(await screen.findByRole('button', { name: 'Form 1 A' }));
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
    await user.click(await screen.findByRole('button', { name: 'Absent: Amina Wanjiru' }));
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
  const INVITED = {
    userId: 'user-new', fullName: 'Mr. Kamau', email: 'kamau@kibera.ac.ke', phone: '0711222333', status: 'invited',
    classes: [], openCode: { purpose: 'invite', expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString() },
  };

  it('lists teachers with the classes they teach', async () => {
    const user = userEvent.setup();
    const onOpenClass = jest.fn();
    render(<AdminTeachers onOpenClass={onOpenClass} />);
    expect(await screen.findByText('Ms. Otieno')).toBeInTheDocument();
    expect(screen.getByText(/No classes yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Form 3 B' }));
    expect(onOpenClass).toHaveBeenCalledWith('class-3b');
  });

  it('invites a teacher and shows the code once, ready to send', async () => {
    const user = userEvent.setup();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    api.inviteTeacher.mockResolvedValue({ teacher: INVITED, code: 'K7QM-4XPA', expiresAt, purpose: 'invite' });
    render(<AdminTeachers onOpenClass={jest.fn()} />);
    await user.click(await screen.findByRole('button', { name: '+ Invite teacher' }));

    const dialog = screen.getByRole('dialog');
    const create = within(dialog).getByRole('button', { name: 'Create invite' });
    expect(create).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Full name'), 'Mr. Kamau');
    await user.type(within(dialog).getByLabelText('Email'), 'kamau@kibera.ac.ke');
    await user.type(within(dialog).getByLabelText(/Phone/), '0711 222 333');
    await user.click(create);
    expect(api.inviteTeacher).toHaveBeenCalledWith('school-1', { fullName: 'Mr. Kamau', email: 'kamau@kibera.ac.ke', phone: '0711222333' });

    const shown = await screen.findByRole('dialog', { name: 'Mr. Kamau is invited' });
    expect(within(shown).getByLabelText('Invite code')).toHaveTextContent('K7QM-4XPA');
    const wa = within(shown).getByRole('link', { name: 'WhatsApp' });
    expect(wa.getAttribute('href').startsWith('https://wa.me/254711222333?text=')).toBe(true);
    expect(decodeURIComponent(wa.getAttribute('href'))).toContain('K7QM-4XPA');
    expect(within(shown).getByRole('link', { name: 'SMS' }).getAttribute('href').startsWith('sms:0711222333?&body=')).toBe(true);
    expect(within(shown).getByRole('link', { name: 'Email' }).getAttribute('href').startsWith('mailto:kamau@kibera.ac.ke?subject=')).toBe(true);
  });

  it('says so when the email already has an account', async () => {
    const user = userEvent.setup();
    api.inviteTeacher.mockRejectedValue(Object.assign(new Error('exists'), { status: 409 }));
    render(<AdminTeachers onOpenClass={jest.fn()} />);
    await user.click(await screen.findByRole('button', { name: '+ Invite teacher' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Full name'), 'Ms. Otieno');
    await user.type(within(dialog).getByLabelText('Email'), 'otieno@kibera.ac.ke');
    await user.click(within(dialog).getByRole('button', { name: 'Create invite' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already has a SmartAttend account');
  });

  it('shows invited teachers and gives them a new code', async () => {
    const user = userEvent.setup();
    api.getTeachers.mockResolvedValue([OTIENO, INVITED]);
    api.newTeacherCode.mockResolvedValue({ teacher: INVITED, code: 'ABCD-EFGH', expiresAt: new Date().toISOString(), purpose: 'invite' });
    render(<AdminTeachers onOpenClass={jest.fn()} />);
    const card = (await screen.findByText('Mr. Kamau')).closest('article');
    expect(within(card).getByText('Invited')).toBeInTheDocument();
    expect(within(card).getByText(/Invite sent/)).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: /New invite code/ }));
    expect(api.newTeacherCode).toHaveBeenCalledWith('user-new');
    expect(await screen.findByLabelText('Invite code')).toHaveTextContent('ABCD-EFGH');
  });

  it('resets a password for a teacher who has signed in', async () => {
    render(<AdminTeachers onOpenClass={jest.fn()} />);
    const card = (await screen.findByText('Ms. Otieno')).closest('article');
    expect(within(card).getByRole('button', { name: /Reset password/ })).toBeInTheDocument();
  });

  it('asks before disabling a teacher', async () => {
    const user = userEvent.setup();
    api.setTeacherEnabled.mockResolvedValue({});
    render(<AdminTeachers onOpenClass={jest.fn()} />);
    const card = (await screen.findByText('Ms. Otieno')).closest('article');
    await user.click(within(card).getByRole('button', { name: /Disable/ }));
    expect(screen.getByText('Are you sure you want to disable Ms. Otieno?')).toBeInTheDocument();
    expect(api.setTeacherEnabled).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, disable' }));
    expect(api.setTeacherEnabled).toHaveBeenCalledWith('user-otieno', false);
  });
});
