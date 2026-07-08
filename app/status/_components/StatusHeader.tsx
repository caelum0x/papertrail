export function StatusHeader() {
  return (
    <>
      <h1 className="text-2xl font-semibold text-ink">Deployment Status</h1>
      <p className="mt-2 text-sm text-ink/60">
        This page reflects the live deployment&apos;s health, checked directly
        against the running instance.
      </p>
    </>
  );
}
