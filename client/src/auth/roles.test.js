import { roleFromGroups, demoRole } from './roles';

describe('role from credentials', () => {
  it('takes the highest Cognito group', () => {
    expect(roleFromGroups(['teacher', 'admin'])).toBe('admin');
    expect(roleFromGroups(['admin', 'system_admin'])).toBe('system_admin');
    expect(roleFromGroups(['teacher'])).toBe('teacher');
  });

  it('treats an account with no group as a teacher', () => {
    expect(roleFromGroups([])).toBe('teacher');
    expect(roleFromGroups(undefined)).toBe('teacher');
  });

  it('gives demo admin addresses their role, ignoring case and spaces', () => {
    expect(demoRole(' Admin@SmartAttend.demo ')).toBe('admin');
    expect(demoRole('sysadmin@smartattend.demo')).toBe('system_admin');
    expect(demoRole('teacher@school.ke')).toBe('teacher');
  });

});
