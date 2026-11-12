import { Monitor, Moon, Sun } from 'lucide-react'
import { useThemePreference } from '../theme'

export default function ThemeControl() {
  const { preference, changePreference } = useThemePreference()
  const Icon = preference === 'dark' ? Moon : preference === 'light' ? Sun : Monitor

  return (
    <label className="theme-control">
      <Icon size={17} aria-hidden="true" />
      <span className="sr-only">Giao diện</span>
      <select aria-label="Giao diện" value={preference}
        onChange={event => changePreference(event.target.value as typeof preference)}>
        <option value="system">Theo hệ thống</option>
        <option value="light">Sáng</option>
        <option value="dark">Tối</option>
      </select>
    </label>
  )
}
