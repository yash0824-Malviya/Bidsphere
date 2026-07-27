import { Search } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export default function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className = "",
}: Props) {
  return (
    <div className={`relative ${className}`}>
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[var(--color-text-faint)]">
        <Search className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-search"
      />
    </div>
  );
}
