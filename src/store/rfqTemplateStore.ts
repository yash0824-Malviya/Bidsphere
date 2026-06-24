import { create } from "zustand";
import type { RFQTemplate } from "../types/erpnext";

export type TemplateDialogMode = "create" | "edit" | "duplicate";

interface RFQTemplateUIState {
  dialogOpen: boolean;
  dialogMode: TemplateDialogMode;
  /** Template being edited/duplicated — null when creating new. */
  activeTemplate: RFQTemplate | null;
  archiveTarget: RFQTemplate | null;

  openCreate: () => void;
  openEdit: (template: RFQTemplate) => void;
  openDuplicate: (template: RFQTemplate) => void;
  closeDialog: () => void;

  openArchiveConfirm: (template: RFQTemplate) => void;
  closeArchiveConfirm: () => void;
}

export const useRFQTemplateStore = create<RFQTemplateUIState>((set) => ({
  dialogOpen: false,
  dialogMode: "create",
  activeTemplate: null,
  archiveTarget: null,

  openCreate: () =>
    set({ dialogOpen: true, dialogMode: "create", activeTemplate: null }),
  openEdit: (template) =>
    set({ dialogOpen: true, dialogMode: "edit", activeTemplate: template }),
  openDuplicate: (template) =>
    set({ dialogOpen: true, dialogMode: "duplicate", activeTemplate: template }),
  closeDialog: () =>
    set({ dialogOpen: false, activeTemplate: null }),

  openArchiveConfirm: (template) => set({ archiveTarget: template }),
  closeArchiveConfirm: () => set({ archiveTarget: null }),
}));
