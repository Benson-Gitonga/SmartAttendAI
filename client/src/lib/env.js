// Vite build-time settings, read in one place so tests (Jest has no
// import.meta) can swap this file for src/lib/env.jest.cjs.
export const env = import.meta.env ?? {};
