import { SECTIONS } from "./sections";
import { DocSectionBlock } from "./DocSectionBlock";

export function DocSectionList() {
  return (
    <>
      {SECTIONS.map((section) => (
        <DocSectionBlock key={section.heading} section={section} />
      ))}
    </>
  );
}
