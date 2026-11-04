/**
 * On/off switches for features that are built but not ready to show.
 *
 * googleSignIn: hidden until the production Google credentials are set up.
 * Flip to true to bring back the "Continue with Google" buttons (sign-in,
 * set-password link, invite code) and the account-sheet link row. The server
 * routes and components are still in place.
 *
 * attendanceImport: the school admin's "Import attendance" button (Students
 * page), a demo tool that loads past registers from a CSV so the risk flags
 * have history. Turn off before real schools use the site.
 */
export const features = {
  googleSignIn: false,
  attendanceImport: true,
};
