import { useTheme, resolvedTheme } from '../lib/theme';
import { SunIcon, MoonIcon } from './icons';

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
];

/**
 * Light / Dark switch. Until someone picks one, the page follows the device
 * setting and the matching button shows as selected. `compact` shows icons only.
 */
export default function ThemeToggle({ compact = false }) {
  const [choice, setTheme] = useTheme();
  const showing = resolvedTheme(choice);
  return (
    <div className={`theme-toggle${compact ? ' theme-toggle--compact' : ''}`} role="group" aria-label="Colour theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className="theme-toggle__btn"
          aria-pressed={showing === value}
          title={`${label} mode`}
          onClick={() => setTheme(value)}
        >
          <Icon size={14} />
          <span className="theme-toggle__label">{label} mode</span>
        </button>
      ))}
    </div>
  );
}
