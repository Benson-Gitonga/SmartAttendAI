import { useEffect, useState } from 'react';

/** The signed-out pages and their hash addresses. Email links point at these. */
export const PUBLIC_PAGES = {
  signin: '#/',
  apply: '#/apply',
  forgot: '#/forgot-password',
  join: '#/join',
  verify: '#/verify-email',
  setPassword: '#/set-password',
  outbox: '#/dev/outbox',
};

/** Which signed-out page the address asks for, and its token or code if any. */
export function readPublicRoute(hash = typeof window !== 'undefined' ? window.location.hash : '') {
  const [path, param] = (() => {
    const clean = hash.replace(/^#/, '') || '/';
    const parts = clean.split('/').filter(Boolean);
    if (parts[0] === 'dev' && parts[1] === 'outbox') return ['outbox', null];
    return [parts[0] ?? '', parts[1] ? decodeURIComponent(parts[1]) : null];
  })();
  const page = {
    apply: 'apply',
    'forgot-password': 'forgot',
    join: 'join',
    'verify-email': 'verify',
    'set-password': 'setPassword',
    outbox: 'outbox',
  }[path] ?? 'signin';
  return { page, param };
}

/** The current signed-out page; follows back/forward and link clicks. */
export function usePublicRoute() {
  const [route, setRoute] = useState(() => readPublicRoute());
  useEffect(() => {
    const update = () => setRoute(readPublicRoute());
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => {
      window.removeEventListener('hashchange', update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return route;
}
