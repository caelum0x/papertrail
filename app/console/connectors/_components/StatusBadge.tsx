import {
  connectorStatusClass,
  connectorStatusLabel,
  directionClass,
  syncStatusClass,
} from "./shared";

// Small pill badges reused across list rows, the detail header, and the panels.

export function ConnectorStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${connectorStatusClass(
        status
      )}`}
    >
      {connectorStatusLabel(status)}
    </span>
  );
}

export function SyncStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs font-medium capitalize ${syncStatusClass(
        status
      )}`}
    >
      {status}
    </span>
  );
}

export function DirectionBadge({ direction }: { direction: string }) {
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs font-medium capitalize ${directionClass(
        direction
      )}`}
    >
      {direction}
    </span>
  );
}
