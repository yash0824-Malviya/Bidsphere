/** Temporary landing page while the Warehouse module is rebuilt. */
export default function WarehousePlaceholderPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="max-w-md rounded-xl border border-neutral-200 bg-white px-8 py-10 shadow-sm">
        <h1 className="text-xl font-bold text-neutral-900">Warehouse Module</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600">
          This module is currently under redevelopment.
        </p>
      </div>
    </div>
  );
}
