import { useState } from "react";
import toast from "react-hot-toast";
import { KeyRound } from "lucide-react";

import AccountShell, {
  AccountCard,
  accountBtnPrimary,
  accountInputClassName,
} from "./AccountShell";

/**
 * Change-password UI only — does not alter authentication backends.
 */
export default function ChangePasswordPage() {
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwd.current || !pwd.next) {
      toast.error("Enter your current and new password");
      return;
    }
    if (pwd.next.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (pwd.next !== pwd.confirm) {
      toast.error("New passwords do not match");
      return;
    }
    setSubmitting(true);
    setPwd({ current: "", next: "", confirm: "" });
    setSubmitting(false);
    toast.success(
      "Password changes are managed in ERPNext. No local auth changes were made.",
      { duration: 5000 },
    );
  };

  return (
    <AccountShell
      title="Change Password"
      description="Update the password used to sign in to BidSphere."
    >
      <AccountCard>
        <form className="mx-auto max-w-md space-y-3" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              Current Password
            </span>
            <input
              type="password"
              autoComplete="current-password"
              className={accountInputClassName}
              value={pwd.current}
              onChange={(e) => setPwd((p) => ({ ...p, current: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              New Password
            </span>
            <input
              type="password"
              autoComplete="new-password"
              className={accountInputClassName}
              value={pwd.next}
              onChange={(e) => setPwd((p) => ({ ...p, next: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              Confirm Password
            </span>
            <input
              type="password"
              autoComplete="new-password"
              className={accountInputClassName}
              value={pwd.confirm}
              onChange={(e) =>
                setPwd((p) => ({ ...p, confirm: e.target.value }))
              }
            />
          </label>
          <div className="pt-1">
            <button
              type="submit"
              className={accountBtnPrimary}
              disabled={submitting}
            >
              <KeyRound className="h-3.5 w-3.5" />
              Change Password
            </button>
          </div>
        </form>
      </AccountCard>
    </AccountShell>
  );
}
