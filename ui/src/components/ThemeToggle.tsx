import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemePreference } from "../lib/theme";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

interface Props {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}

export function ThemeToggle({ value, onChange }: Props) {
  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      {OPTIONS.map(({ value: option, label, Icon }) => (
        <button
          key={option}
          type="button"
          className="theme-toggle-option"
          aria-label={`${label} theme`}
          aria-pressed={value === option}
          title={`${label} theme`}
          onClick={() => onChange(option)}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
