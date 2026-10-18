import { RosterIcon, GridIcon, BellIcon, HomeIcon, UsersIcon, CalendarIcon, BuildingIcon } from './icons';

/** Nav items for the signed-in role. Shared by BottomNav (phone) and SideNav (desktop). */
export function navItems(role) {
  // The school admin supervises the whole school rather than teaching a class.
  if (role === 'admin') {
    return [
      { id: 'today', label: 'Today', short: 'Today', Icon: CalendarIcon },
      { id: 'classes', label: 'Classes', short: 'Classes', Icon: BuildingIcon },
      { id: 'teachers', label: 'Teachers', short: 'Teachers', Icon: UsersIcon },
      { id: 'overview', label: 'At-risk students', short: 'At-risk', Icon: BellIcon },
    ];
  }
  const items = [
    { id: 'dashboard', label: 'Dashboard', short: 'Home', Icon: HomeIcon },
    { id: 'attendance', label: 'Take Attendance', short: 'Register', Icon: RosterIcon },
    { id: 'heatmap', label: 'Reports', short: 'Reports', Icon: GridIcon },
    { id: 'alerts', label: 'At-risk Students', short: 'At-risk', Icon: BellIcon },
  ];
  items.push({ id: 'students', label: 'Students', short: 'Students', Icon: UsersIcon, section: 'Manage' });
  return items;
}

export default function BottomNav({ active, onChange, alertCount = 0, role, registerStatus = null }) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {navItems(role).map(({ id, short, Icon }) => (
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
