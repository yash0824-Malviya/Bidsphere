import { ClipboardCheck, Plus } from "lucide-react";
import { Link } from "react-router-dom";

export default function ECREmptyState({
  title,
  description,
  createAction = false,
}: {
  title: string;
  description?: string;
  createAction?: boolean;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center px-5 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100">
        <ClipboardCheck className="h-5 w-5 text-neutral-400" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-neutral-900">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-xs leading-5 text-neutral-500">{description}</p>
      ) : null}
      {createAction ? (
        <Link
          to="/ecr/new"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700"
        >
          <Plus className="h-3.5 w-3.5" />
          Create New ECR
        </Link>
      ) : null}
    </div>
  );
}
