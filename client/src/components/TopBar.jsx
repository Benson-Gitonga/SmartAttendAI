import ThemeToggle from './ThemeToggle';
import { ChevronDownIcon, ChevronRightIcon, ChevronLeftIcon, UserIcon, BrandCheckIcon, SyncIcon } from './icons';

/**
 * Screen header with a breadcrumb, e.g. "Form 3 B > At-risk Students > Kevin".
 * Each crumb is `{ label, onClick?, picker? }`; a crumb with `onClick` is a link,
 * `picker` adds a dropdown chevron (the class switcher). On phones a deep page
 * shows only "< Parent" and the current page.
 *
 * `pending` (attendance records saved on this phone but not yet on the
 * server) shows as a badge on every screen size, so a teacher knows not to
 * clear the browser or switch phones before it reaches zero.
 */
export default function TopBar({ crumbs = [], online, pending = 0, onAccount }) {
  const current = crumbs[crumbs.length - 1];
  const parent = crumbs.length > 2 ? crumbs[crumbs.length - 2] : null;

  return (
    <header className="topbar">
      <nav className={`topbar__crumbs${parent ? ' topbar__crumbs--deep' : ''}`} aria-label="Breadcrumb">
        <span className="topbar__logo" aria-hidden="true"><BrandCheckIcon size={22} /></span>

        {parent && (
          <button type="button" className="topbar__up" onClick={parent.onClick} aria-label={`Back to ${parent.label}`}>
            <ChevronLeftIcon size={16} />
            {/* Phones show where back goes; desktops keep the trail beside it. */}
            <span className="topbar__up-parent">{parent.label}</span>
            <span className="topbar__up-back">Back</span>
          </button>
        )}

        <ol className="crumbs">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={`${i}-${c.label}`} className={c.picker ? 'crumbs__item crumbs__item--picker' : 'crumbs__item'}>
                {last ? (
                  <h1 className="screen-title" aria-current="page">{c.label}</h1>
                ) : (
                  <button
                    type="button"
                    className="crumbs__link"
                    onClick={c.onClick}
                    title={c.picker ? 'Switch class' : `Go to ${c.label}`}
                  >
                    {c.label}
                    {c.picker && <ChevronDownIcon size={14} />}
                  </button>
                )}
                {!last && <ChevronRightIcon size={14} className="crumbs__sep" />}
              </li>
            );
          })}
        </ol>
        {current && <span className="sr-only">Current page: {current.label}</span>}
      </nav>

      <div className="topbar__right">
        <ThemeToggle compact />
        {pending > 0 && (
          <button
            type="button"
            className={`pending-chip${online === false ? ' pending-chip--offline' : ''}`}
            onClick={onAccount}
            disabled={!onAccount}
            title={online === false
              ? `${pending} record${pending === 1 ? '' : 's'} saved on this phone. They send when you are back online.`
              : `Sending ${pending} record${pending === 1 ? '' : 's'} to the school…`}
            aria-label={`${pending} attendance record${pending === 1 ? '' : 's'} waiting to send`}
          >
            <SyncIcon size={14} />
            <span className="pending-chip__n">{pending}</span>
            <span className="pending-chip__label">to send</span>
          </button>
        )}
        {online !== undefined && (
          <span className={`status-chip status-chip--${online ? 'online' : 'offline'}`}>
            <span className={`dot dot--${online ? 'present' : 'warn'}`} />
            {online ? 'Online' : 'Offline'}
          </span>
        )}
        {onAccount && (
          <button
            type="button"
            className="avatar-btn"
            onClick={onAccount}
            aria-label="Account and sync status"
          >
            <UserIcon size={18} />
          </button>
        )}
      </div>
    </header>
  );
}
