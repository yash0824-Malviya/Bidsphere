import { create } from "zustand";
import {
  getScoringConfig,
  saveScoringConfig,
  validateScoringWeights,
  type ScoringWeights,
  type ScoringValidationResult,
} from "../api/supplierScoring";
import { DEFAULT_SCORING_WEIGHTS } from "../types/erpnext";

interface SupplierScoringState {
  /** Current weight values in the form (local draft). */
  weights: ScoringWeights;
  /** Last-saved server values (null until first fetch). */
  saved: ScoringWeights | null;
  /** Live validation result derived from `weights`. */
  validation: ScoringValidationResult;

  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  /** Whether the local draft differs from the server copy. */
  isDirty: boolean;

  setWeight: (field: keyof ScoringWeights, value: number) => void;
  resetToDefaults: () => void;
  resetToSaved: () => void;
  fetchConfig: () => Promise<void>;
  saveConfig: () => Promise<void>;
}

function deriveValidation(weights: ScoringWeights): ScoringValidationResult {
  return validateScoringWeights(weights);
}

function weightsEqual(a: ScoringWeights, b: ScoringWeights): boolean {
  return (
    a.price_weight === b.price_weight &&
    a.delivery_weight === b.delivery_weight &&
    a.quality_weight === b.quality_weight &&
    a.reliability_weight === b.reliability_weight
  );
}

const initialWeights: ScoringWeights = { ...DEFAULT_SCORING_WEIGHTS };

export const useSupplierScoringStore = create<SupplierScoringState>(
  (set, get) => ({
    weights: initialWeights,
    saved: null,
    validation: deriveValidation(initialWeights),
    isLoading: false,
    isSaving: false,
    error: null,
    isDirty: false,

    setWeight: (field, value) => {
      const next = { ...get().weights, [field]: value };
      const saved = get().saved;
      set({
        weights: next,
        validation: deriveValidation(next),
        isDirty: saved ? !weightsEqual(next, saved) : true,
      });
    },

    resetToDefaults: () => {
      const defaults: ScoringWeights = { ...DEFAULT_SCORING_WEIGHTS };
      const saved = get().saved;
      set({
        weights: defaults,
        validation: deriveValidation(defaults),
        isDirty: saved ? !weightsEqual(defaults, saved) : false,
      });
    },

    resetToSaved: () => {
      const saved = get().saved;
      if (!saved) return;
      set({
        weights: { ...saved },
        validation: deriveValidation(saved),
        isDirty: false,
      });
    },

    fetchConfig: async () => {
      set({ isLoading: true, error: null });
      try {
        const config = await getScoringConfig();
        const weights: ScoringWeights = {
          price_weight: config.price_weight,
          delivery_weight: config.delivery_weight,
          quality_weight: config.quality_weight,
          reliability_weight: config.reliability_weight,
        };
        set({
          weights,
          saved: weights,
          validation: deriveValidation(weights),
          isLoading: false,
          isDirty: false,
        });
      } catch (err) {
        set({
          isLoading: false,
          error: err instanceof Error ? err.message : "Failed to load config",
        });
      }
    },

    saveConfig: async () => {
      const { weights, validation } = get();
      if (!validation.valid) return;

      set({ isSaving: true, error: null });
      try {
        const saved = await saveScoringConfig(weights);
        const serverWeights: ScoringWeights = {
          price_weight: saved.price_weight,
          delivery_weight: saved.delivery_weight,
          quality_weight: saved.quality_weight,
          reliability_weight: saved.reliability_weight,
        };
        set({
          saved: serverWeights,
          weights: serverWeights,
          validation: deriveValidation(serverWeights),
          isSaving: false,
          isDirty: false,
        });
      } catch (err) {
        set({
          isSaving: false,
          error: err instanceof Error ? err.message : "Failed to save config",
        });
        throw err;
      }
    },
  })
);
