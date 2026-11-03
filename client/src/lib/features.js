/**
 * On/off switches for features that are built but not ready to show.
 *
 * googleSignIn: hidden until the production Google credentials are set up.
 * Flip to true to bring back the "Continue with Google" buttons (sign-in,
 * set-password link, invite code) and the account-sheet link row. The server
 * routes and components are still in place.
 */
export const features = {
  googleSignIn: false,
};
