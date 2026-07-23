/**
 * Client-only profile photo / optional contact fields.
 * No backend writes — auth and ERPNext logic stay untouched.
 */

const PROFILE_KEY = "bidsphere.account.profileOverlay";

export interface ProfileOverlay {
  phone?: string;
  company?: string;
  employeeId?: string;
  joiningDate?: string;
  photoDataUrl?: string;
}

function readAll(): Record<string, ProfileOverlay> {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ProfileOverlay>;
  } catch {
    return {};
  }
}

export function loadProfileOverlay(email: string): ProfileOverlay {
  return readAll()[email.toLowerCase()] ?? {};
}

export function saveProfileOverlay(email: string, overlay: ProfileOverlay): void {
  try {
    const all = readAll();
    all[email.toLowerCase()] = overlay;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota / private mode */
  }
}
