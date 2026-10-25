import { RosterIcon, GridIcon, BellIcon, HomeIcon, UsersIcon, CalendarIcon, BuildingIcon, KeypadIcon, UserIcon } from './icons';

/** Nav items for the signed-in role. Shared by BottomNav (phone) and SideNav (desktop). */
export function navItems(role) {
  // The school admin supervises the whole school rather than teaching a class.
  if (role === 'admin') {
    return [
      { id: 'today', label: 'Today', short: 'Today', Icon: CalendarIcon },
      { id: 'classes', label: 'Classes', short: 'Classes', Icon: BuildingIcon },
      { id: 'students', label: 'Students', short: 'Students', Icon: UsersIcon },
      { id: 'teachers', label: 'Teachers', short: 'Teachers', Icon: UserIcon },
      { id: 'overview', label: 'At-risk students', short: 'At-risk', Icon: BellIcon },
      // Phones reach the scan station from the Today page instead.
      { id: 'scan', label: 'Scan station', short: 'Scan', Icon: KeypadIcon, section: 'Tools', desktopOnly: true },
    ];
  }
  const items = [
    { id: 'dashboard', label: 'Dashboard', short: 'Home', Icon: HomeIcon },
    { id: 'attendance', label: 'Take Attendance', short: 'Register', Icon: RosterIcon },
    { id: 'heatmap', label: 'Reports', short: 'Reports', Icon: GridIcon },
    { id: 'alerts', label: 'At-risk Students', short: 'At-risk', Icon: BellIcon },
  ];
  items.push({ id: 'students', label: 'Students', short: 'Students', Icon: UsersIcon, section: 'Manage' });
  // For gate duty. Phones reach it from the dashboard instead.
  items.push({ id: 'scan', label: 'Scan station', short: 'Scan', Icon: KeypadIcon, section: 'Tools', desktopOnly: true });
  return items;
}

export default function BottomNav({ active, onChange, alertCount = 0, role, registerStatus = null }) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {navItems(role).filter((item) => !item.desktopOnly).map(({ id, short, Icon }) => (
        <button
          key={id}
          type="button"
          className="bottom-nav__item"
          aria-current={active === id ? 'page' : undefined}
          onClick={() => onChange(id)}
        >
          <span className="bottom-nav__pill">
            <Icon size={20} />
            {id === 'alerts' && alertCount > 0 && <span className="nav-count">{alertCount}</span>}
            {id === 'attendance' && registerStatus === 'due' && <span className="nav-dot" aria-label="Register due" />}
          </span>
          <span>{short}</span>
        </button>
      ))}
    </nav>
  );
}
