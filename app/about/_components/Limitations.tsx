import { LIMITATIONS } from "./aboutData";

export function Limitations() {
  return (
    <ul className="space-y-3 text-sm leading-relaxed text-ink/80">
      {LIMITATIONS.map((item) => (
        <li key={item.title} className="flex gap-2">
          <span aria-hidden className="text-ink/30">—</span>
          <span>
            <span className="font-medium text-ink">{item.title}</span> {item.body}
          </span>
        </li>
      ))}
    </ul>
  );
}
