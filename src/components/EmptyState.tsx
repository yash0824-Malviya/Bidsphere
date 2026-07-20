import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
import EnterpriseEmptyState from "./enterprise/EnterpriseEmptyState";

interface Props {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Empty-data state — enterprise illustration layout. */
export default function EmptyState({
  icon = Inbox,
  title,
  description,
  action,
  className,
}: Props) {
  return (
    <EnterpriseEmptyState
      icon={icon}
      title={title}
      description={description}
      action={action}
      className={className}
    />
  );
}
