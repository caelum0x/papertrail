import { RELEASES } from "./releases";
import { ReleaseSection } from "./ReleaseSection";

export function ReleaseList() {
  return (
    <div className="space-y-10">
      {RELEASES.map((release) => (
        <ReleaseSection key={release.version} release={release} />
      ))}
    </div>
  );
}
