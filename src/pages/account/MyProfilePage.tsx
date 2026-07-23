import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Camera, Pencil, Save, X } from "lucide-react";

import {
  displayNameForAuthenticatedUser,
  ROLE_LABELS,
} from "../../config/roles";
import { useAuthStore } from "../../store/authStore";
import AccountShell, {
  AccountCard,
  FieldGrid,
  FieldItem,
  accountBtnPrimary,
  accountBtnSecondary,
  accountInputClassName,
} from "./AccountShell";
import {
  loadProfileOverlay,
  saveProfileOverlay,
  type ProfileOverlay,
} from "./accountStorage";

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function MyProfilePage() {
  const user = useAuthStore((s) => s.user);
  const email = user?.email ?? "";
  const fileRef = useRef<HTMLInputElement>(null);

  const [overlay, setOverlay] = useState<ProfileOverlay>(() =>
    email ? loadProfileOverlay(email) : {},
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileOverlay>(overlay);

  useEffect(() => {
    if (!email) return;
    const next = loadProfileOverlay(email);
    setOverlay(next);
    setDraft(next);
  }, [email]);

  const displayName = user ? displayNameForAuthenticatedUser(user) : "—";

  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

  const roleLabel = user?.role ? ROLE_LABELS[user.role] : "—";

  const onSave = () => {
    if (!email) return;
    saveProfileOverlay(email, draft);
    setOverlay(draft);
    setEditing(false);
    toast.success("Profile updated");
  };

  const onPhoto = (file: File | null) => {
    if (!file || !email) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Photo must be under 2 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const photoDataUrl = String(reader.result ?? "");
      const next = { ...overlay, photoDataUrl };
      saveProfileOverlay(email, next);
      setOverlay(next);
      setDraft(next);
      toast.success("Profile photo updated");
    };
    reader.readAsDataURL(file);
  };

  return (
    <AccountShell
      title="My Profile"
      description="Your account details in BidSphere."
      actions={
        <>
          <button
            type="button"
            className={accountBtnSecondary}
            onClick={() => fileRef.current?.click()}
          >
            <Camera className="h-3.5 w-3.5" />
            Upload Photo
          </button>
          {editing ? (
            <>
              <button
                type="button"
                className={accountBtnSecondary}
                onClick={() => {
                  setDraft(overlay);
                  setEditing(false);
                }}
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button type="button" className={accountBtnPrimary} onClick={onSave}>
                <Save className="h-3.5 w-3.5" />
                Save
              </button>
            </>
          ) : (
            <button
              type="button"
              className={accountBtnPrimary}
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit Profile
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPhoto(e.target.files?.[0] ?? null)}
          />
        </>
      }
    >
      <AccountCard>
        <div className="flex items-center gap-4 border-b border-[#E2E8F0] pb-4">
          {overlay.photoDataUrl ? (
            <img
              src={overlay.photoDataUrl}
              alt=""
              className="h-16 w-16 rounded-full object-cover ring-2 ring-primary-100"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-500 text-[18px] font-semibold text-white ring-2 ring-primary-100">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-semibold text-neutral-900">
              {displayName}
            </h2>
            <p className="mt-0.5 text-[13px] text-primary-700">{roleLabel}</p>
            <p className="mt-0.5 truncate text-[12px] text-neutral-500">
              {email || "—"}
            </p>
          </div>
        </div>

        <div className="pt-4">
          {editing ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(
                [
                  ["phone", "Phone"],
                  ["company", "Company"],
                  ["employeeId", "Employee ID"],
                  ["joiningDate", "Joining Date"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                    {label}
                  </span>
                  <input
                    type={key === "joiningDate" ? "date" : "text"}
                    className={accountInputClassName}
                    value={draft[key] ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
          ) : (
            <FieldGrid>
              <FieldItem label="Full Name" value={displayName} />
              <FieldItem label="Role" value={roleLabel} />
              <FieldItem label="Department" value={user?.department || "—"} />
              <FieldItem label="Company" value={overlay.company || "—"} />
              <FieldItem label="Employee ID" value={overlay.employeeId || "—"} />
              <FieldItem label="Email" value={email || "—"} />
              <FieldItem label="Phone" value={overlay.phone || "—"} />
              <FieldItem
                label="Joining Date"
                value={
                  overlay.joiningDate ? formatDate(overlay.joiningDate) : "—"
                }
              />
              <FieldItem
                label="Status"
                value={<span className="text-emerald-700">Active</span>}
              />
            </FieldGrid>
          )}
        </div>
      </AccountCard>
    </AccountShell>
  );
}
