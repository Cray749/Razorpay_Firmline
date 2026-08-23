export function StampBadge({ cleared, label, animate = false }: { cleared: boolean; label: string; animate?: boolean }) {
  return (
    <span className={`stamp ${cleared ? "stamp-cleared" : "stamp-blocked"} ${animate ? "stamp-animate" : ""}`}>
      {cleared ? "✓" : "✕"} {label}
    </span>
  );
}
