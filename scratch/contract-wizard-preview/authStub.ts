const state = { user: { name: "UI QA Procurement Manager", email: "procurement-ui-qa@example.test", role: "procurement" } };
export function useAuthStore(selector: (value: typeof state) => unknown) { return selector(state); }
