// Extends Vitest's `expect` with jest-dom matchers (toBeInTheDocument, etc.).
// Importing this is harmless under the node environment used by existing .test.ts
// files — it only augments the expect object; it does not require a DOM at import.
import "@testing-library/jest-dom/vitest";
