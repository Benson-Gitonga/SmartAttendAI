import { useCallback, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useHashRoute } from '../../hooks/useHashRoute';
import SideNav from '../SideNav';
import BottomNav from '../BottomNav';
import TopBar from '../TopBar';
import AccountSheet from '../AccountSheet';
import PinSetup from '../PinSetup';
import Toaster from '../Toaster';
import ConfirmDialog from '../ConfirmDialog';
import AdminOverview from '../AdminOverview';
import AdminToday from './AdminToday';
import AdminClasses from './AdminClasses';
import AdminClassPage from './AdminClassPage';
import AdminTeachers from './AdminTeachers';
import { LogOutIcon } from '../icons';

const ADMIN_TITLES = {
  today: 'Today',
  classes: 'Classes',
  teachers: 'Teachers',
  overview: 'At-risk students',
};
const ADMIN_TABS = Object.keys(ADMIN_TITLES);

/**
 * The school admin's app: supervising the whole school rather than teaching
 * a class. Everything here is read from and written to the server live.
 */
export default function AdminApp() {
  const { user, session, pinState, signOut } = useAuth();
  const online = useOnlineStatus();
  const [route, navigate] = useHashRoute();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pinSetupOpen, setPinSetupOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [classTitle, setClassTitle] = useState({});

  const tab = ADMIN_TABS.includes(route.tab) ? route.tab : 'today';
  const goTab = useCallback((next) => navigate({ tab: next }), [navigate]);
  // Class pages hang off the Classes section whichever page opened them, so
  // "Back" lands on the class list or the page the admin came from.
  const openClass = useCallback((classGroupId) => navigate({ tab, classId: classGroupId }), [navigate, tab]);
  const rememberClassTitle = useCallback((id, title) => setClassTitle((t) => (t[id] === title ? t : { ...t, [id]: title })), []);

  if (pinSetupOpen) {
    return (
      <PinSetup
        changing={pinState.enrolled}
        skipLabel="Cancel"
        onDone={() => setPinSetupOpen(false)}
        onSkip={() => setPinSetupOpen(false)}
      />
    );
  }

  let body;
  let detail = null;
  if (route.classId) {
    body = <AdminClassPage key={route.classId} classGroupId={route.classId} onTitle={rememberClassTitle} />;
    detail = classTitle[route.classId] ?? 'Class';
  } else if (tab === 'classes') {
    body = <AdminClasses onOpenClass={openClass} />;
  } else if (tab === 'teachers') {
    body = <AdminTeachers onOpenClass={openClass} />;
  } else if (tab === 'overview') {
    body = <AdminOverview onOpenClass={openClass} />;
  } else {
    body = <AdminToday onOpenClass={openClass} />;
  }

  const schoolCrumb = { label: user?.schoolName || 'School' };
  const crumbs = detail
    ? [schoolCrumb, { label: ADMIN_TITLES[tab], onClick: () => navigate({ tab }, { up: true }) }, { label: detail }]
    : [schoolCrumb, { label: ADMIN_TITLES[tab] }];

  return (
    <div className="shell ad">
      <SideNav
        active={tab}
        onChange={goTab}
        role="admin"
        user={user}
        online={online}
        onAccount={() => setSheetOpen(true)}
      />
      <div className="app">
        <TopBar crumbs={crumbs} online={online} onAccount={() => setSheetOpen(true)} />
        <div className="app__scroll">{body}</div>
        <BottomNav active={tab} onChange={goTab} role="admin" />
      </div>
      <Toaster />

      {sheetOpen && (
        <AccountSheet
          user={user}
          online={online}
          pending={0}
          pinSession={Boolean(session?.pinVerified)}
          pinEnrolled={pinState.enrolled}
          onManagePin={() => { setSheetOpen(false); setPinSetupOpen(true); }}
          onSignOut={() => { setSheetOpen(false); setConfirmSignOut(true); }}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {confirmSignOut && (
        <ConfirmDialog
          tone="danger"
          Icon={LogOutIcon}
          title="Are you sure you want to sign out?"
          body="You will need your email and password to sign back in."
          confirmLabel="Yes, sign out"
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={() => { setConfirmSignOut(false); signOut(); }}
        />
      )}
    </div>
  );
}
