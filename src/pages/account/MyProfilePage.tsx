import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Camera,
  CheckCircle2,
  KeyRound,
  Mail,
  Pencil,
  Phone,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";

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

  const initials =
    displayName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const roleLabel = user?.role ? ROLE_LABELS[user.role] : "Department User";

  const onSave = () => {
    if (!email) return;
    saveProfileOverlay(email, draft);
    setOverlay(draft);
    setEditing(false);
    toast.success("Profile updated successfully");
  };

  const onPhoto = (file: File | null) => {
    if (!file || !email) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file (PNG, JPG, WEBP)");
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
      description="Manage your personal details, department assignments, and contact information."
      maxWidthClass="max-w-[1000px]"
      actions={
        <>
          <button
            type="button"
            className={accountBtnSecondary}
            onClick={() => fileRef.current?.click()}
          >
            <Camera className="h-4 w-4 text-slate-500" />
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
                <X className="h-4 w-4 text-slate-500" />
                Cancel
              </button>
              <button type="button" className={accountBtnPrimary} onClick={onSave}>
                <Save className="h-4 w-4" />
                Save Changes
              </button>
            </>
          ) : (
            <button
              type="button"
              className={accountBtnPrimary}
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-4 w-4" />
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
      <div className="space-y-6">
        {/* Profile Header Card */}
        <AccountCard>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4 sm:gap-5">
              <div className="relative shrink-0">
                {overlay.photoDataUrl ? (
                  <img
                    src={overlay.photoDataUrl}
                    alt=""
                    className="h-20 w-20 rounded-full object-cover ring-4 ring-primary-50 shadow-sm"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-600 text-xl font-bold text-white ring-4 ring-primary-50 shadow-sm">
                    {initials}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full border border-white bg-slate-800 text-white shadow-sm hover:bg-slate-700"
                  title="Change avatar"
                >
                  <Camera className="h-3 w-3" />
                </button>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg font-bold text-slate-900 sm:text-xl">
                    {displayName}
                  </h2>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200/60">
                    <CheckCircle2 className="h-3 w-3" />
                    Active
                  </span>
                </div>
                <p className="mt-0.5 text-sm font-semibold text-primary-700">
                  {roleLabel}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5 text-slate-400" />
                    {email || "—"}
                  </span>
                  {overlay.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5 text-slate-400" />
                      {overlay.phone}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex sm:flex-col items-start sm:items-end justify-between border-t border-slate-100 pt-3 sm:border-t-0 sm:pt-0">
              <Link
                to="/account/change-password"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-800 hover:underline"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Change Password →
              </Link>
            </div>
          </div>
        </AccountCard>

        {/* Profile Information Details */}
        <AccountCard>
          <div className="border-b border-slate-100 pb-3 mb-5">
            <h3 className="text-sm font-bold text-slate-900">
              Personal & Organizational Information
            </h3>
            <p className="text-xs text-slate-500">
              Your organizational identity and role details in BidSphere
            </p>
          </div>

          {editing ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Full Name
                </span>
                <input
                  type="text"
                  disabled
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 cursor-not-allowed"
                  value={displayName}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Email Address
                </span>
                <input
                  type="email"
                  disabled
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 cursor-not-allowed"
                  value={email}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Phone Number
                </span>
                <input
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  className={accountInputClassName}
                  value={draft.phone ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, phone: e.target.value }))
                  }
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Company
                </span>
                <input
                  type="text"
                  placeholder="Netlink Digital"
                  className={accountInputClassName}
                  value={draft.company ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, company: e.target.value }))
                  }
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Employee ID
                </span>
                <input
                  type="text"
                  placeholder="EMP-00124"
                  className={accountInputClassName}
                  value={draft.employeeId ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, employeeId: e.target.value }))
                  }
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Joining Date
                </span>
                <input
                  type="date"
                  className={accountInputClassName}
                  value={draft.joiningDate ?? ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, joiningDate: e.target.value }))
                  }
                />
              </label>
            </div>
          ) : (
            <FieldGrid>
              <FieldItem
                label="Full Name"
                value={displayName}
                subtext="Registered system name"
              />
              <FieldItem
                label="Assigned Role"
                value={
                  <span className="inline-flex items-center gap-1 text-primary-700 font-bold">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {roleLabel}
                  </span>
                }
                subtext="Permissions group"
              />
              <FieldItem
                label="Department"
                value={user?.role === "legal" ? (user?.department || "Legal & Compliance") : (user?.department || "Department")}
                subtext="Primary department"
              />
              <FieldItem
                label="Company"
                value={overlay.company || "Netlink Digital"}
                subtext="Operating entity"
              />
              <FieldItem
                label="Employee ID"
                value={overlay.employeeId || "EMP-00284"}
                subtext="Internal staff identifier"
              />
              <FieldItem
                label="Email Address"
                value={email || "—"}
                subtext="Official notification address"
              />
              <FieldItem
                label="Phone Number"
                value={overlay.phone || "+1 (555) 382-9910"}
                subtext="Work direct line"
              />
              <FieldItem
                label="Joining Date"
                value={
                  overlay.joiningDate ? formatDate(overlay.joiningDate) : "Jan 15, 2024"
                }
                subtext="Tenure start date"
              />
              <FieldItem
                label="Account Status"
                value={
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Active · Verified
                  </span>
                }
                subtext="Authentication status"
              />
            </FieldGrid>
          )}
        </AccountCard>
      </div>
    </AccountShell>
  );
}
