import { Construction } from "lucide-react";

interface Props {
  title: string;
  description?: string;
}

export default function Placeholder({ title, description }: Props) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-12 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-600">
        <Construction className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-semibold text-neutral-900">{title}</h2>
      <p className="mt-2 text-sm text-neutral-500">
        {description ??
          "This module will be implemented in a future iteration."}
      </p>
    </div>
  );
}
