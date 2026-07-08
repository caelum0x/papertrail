import { DATA_HANDLING } from "./data";

export function DataHandlingSection() {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold">Data handling</h2>
      <ul className="mt-4 space-y-2 text-sm leading-relaxed text-ink/80">
        {DATA_HANDLING.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden className="text-ink/30">
              —
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
