// Nobody picks their own role: it comes with the account.

/** Cognito mode: the user pool groups an administrator put the account in. The highest wins. */
const ROLE_ORDER = ['system_admin', 'admin', 'teacher'];
export function roleFromGroups(groups = []) {
  return ROLE_ORDER.find((role) => groups.includes(role)) ?? 'teacher';
}

/**
 * Demo mode has no user pool, so these addresses stand in for accounts that
 * were given admin access. Every other address signs in as a teacher.
 */
export const DEMO_ROLES = {
  'admin@smartattend.demo': 'admin',
  'sysadmin@smartattend.demo': 'system_admin'
};
export function demoRole(email) {
  return DEMO_ROLES[String(email ?? '').trim().toLowerCase()] ?? 'teacher';
}
