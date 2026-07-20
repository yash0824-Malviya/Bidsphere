import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  OnboardingError,
  listCategories,
  createOnboarding,
  updateProcurementDraft,
  generateLink,
  generateSupplierAccount,
  getByToken,
  supplierSaveDraft,
  supplierSubmit,
  listOnboardings,
  getOnboarding,
  getStats,
  requestChanges,
  rejectOnboarding,
  approveStage,
  resolveDocnameForToken,
  resolveDocnameForSession,
  toFriendlyOnboardingError,
  portalLogin,
  portalChangePassword,
  portalGetProfile,
  portalSaveDraft,
  portalSubmit,
  portalAddComment,
  portalForgotPassword,
  portalResetPasswordWithOtp,
  portalGetSecurity,
  portalChangePin,
  portalLogoutOtherSessions,
  portalAuthenticatePin,
  extractPortalSessionToken,
  listDiscussion,
  addDiscussionMessage,
  markDiscussionRead,
  resolveDiscussionMessage,
} from "./supplierOnboardingCore.js";
import {
  legacyPinGetProfile,
  legacyPinSaveProfile,
  legacyPinResolveUpload,
  legacyPinListDiscussion,
  legacyPinSendDiscussion,
  legacyPinMarkDiscussionRead,
  isLegacyPinProfileEnabledServer,
} from "./legacyPinProfileCore.js";
import {
  RbacError,
  issueSupplierAccessToken,
  requireInternalAuth,
  requireSupplierAuth,
  requireRoles,
  rolesForOnboardingAction,
} from "./rbacAuth.js";

/**
 * POST/GET /api/supplier-onboarding/:action
 * Privileged ERP API-key only — never touches browser sid cookies.
 * Procurement actions require a signed internal access token + role.
 * Portal actions require a supplier portal session_token (existing).
 */

function readAction(req: VercelRequest): string {
  const q = req.query.action;
  if (Array.isArray(q)) return q[0] ?? "";
  if (typeof q === "string" && q) return q;
  const url = req.url ?? "";
  const m = /\/api\/supplier-onboarding\/([^/?]+)/.exec(url);
  return m?.[1] ?? "";
}

function stripWrappingQuotes(value: string): string {
  let s = String(value ?? "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

async function readJsonBody(req: VercelRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body as Record<string, unknown>;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new OnboardingError("Invalid JSON body.");
  }
}

/** Narrow unknown JSON values to a plain object before spreading. */
function asPlainObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readStringField(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = body[key];
  return typeof v === "string" ? v : v != null ? String(v) : undefined;
}

function asDocumentUploads(
  value: unknown,
): Array<{ document_type: string; file_url: string; file_name?: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    const row = asPlainObject(item);
    return {
      document_type: String(row.document_type ?? ""),
      file_url: String(row.file_url ?? ""),
      file_name:
        row.file_name != null ? String(row.file_name) : undefined,
    };
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const action = readAction(req);

  try {
    const access = rolesForOnboardingAction(action);
    if (access !== "public" && access !== "portal") {
      const principal = requireInternalAuth(req.headers as Record<string, unknown>);
      requireRoles(principal, access);
    }

    if (action === "list-categories" && (req.method === "GET" || req.method === "POST")) {
      const body =
        req.method === "POST" ? await readJsonBody(req) : (req.query as Record<string, unknown>);
      const type = typeof body.supplier_type === "string" ? body.supplier_type : undefined;
      const categories = await listCategories(type);
      res.status(200).json({ success: true, categories });
      return;
    }

    if (action === "stats" && req.method === "GET") {
      const stats = await getStats();
      res.status(200).json({ success: true, stats });
      return;
    }

    if (action === "list" && (req.method === "GET" || req.method === "POST")) {
      const body =
        req.method === "POST" ? await readJsonBody(req) : (req.query as Record<string, string>);
      const rows = await listOnboardings({
        status: body.status as string | undefined,
        supplier_type: body.supplier_type as string | undefined,
        supplier_category: body.supplier_category as string | undefined,
        search: body.search as string | undefined,
        limit: body.limit ? Number(body.limit) : undefined,
      });
      res.status(200).json({ success: true, records: rows });
      return;
    }

    if (action === "get" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await getOnboarding(String(body.name || ""));
      res.status(200).json(result);
      return;
    }

    if (action === "create" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await createOnboarding(body as never);
      res.status(200).json(result);
      return;
    }

    if (action === "save-draft" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await updateProcurementDraft(body as never);
      res.status(200).json(result);
      return;
    }

    if (
      (action === "generate-link" || action === "generate-account") &&
      req.method === "POST"
    ) {
      const body = await readJsonBody(req);
      const result =
        action === "generate-account"
          ? await generateSupplierAccount(body as never)
          : await generateLink(body as never);
      res.status(200).json(result);
      return;
    }

    if (action === "get-by-token" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await getByToken(String(body.token || ""));
      res.status(200).json({ success: true, ...result });
      return;
    }

    if (action === "supplier-save-draft" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await supplierSaveDraft(body as never);
      res.status(200).json(result);
      return;
    }

    if (action === "supplier-submit" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await supplierSubmit(body as never);
      res.status(200).json(result);
      return;
    }

    if (action === "resolve-upload" && req.method === "POST") {
      const body = await readJsonBody(req);
      if (body.session_token) {
        const docname = await resolveDocnameForSession(String(body.session_token));
        res.status(200).json({ success: true, doctype: "Supplier Onboarding", docname });
        return;
      }
      const docname = await resolveDocnameForToken(String(body.token || ""));
      res.status(200).json({ success: true, doctype: "Supplier Onboarding", docname });
      return;
    }

    if (action === "portal-login" && req.method === "POST") {
      const body = await readJsonBody(req);
      const fwd = req.headers["x-forwarded-for"];
      const ip =
        (Array.isArray(fwd) ? fwd[0] : String(fwd || "").split(",")[0]?.trim()) ||
        String(req.headers["x-real-ip"] || "") ||
        "";
      const result = await portalLogin({
        username: String(body.username ?? ""),
        password: String(body.password ?? ""),
        client: {
          ...asPlainObject(body.client),
          ip: ip || undefined,
          user_agent: String(req.headers["user-agent"] || ""),
        },
      });
      const supplier =
        stripWrappingQuotes(
          String(
            (result as { linked_supplier?: string; company_name?: string })
              .linked_supplier ||
              (result as { company_name?: string }).company_name ||
              "",
          ),
        ) || "supplier";
      const onboarding = String(
        (result as { record?: { name?: string } }).record?.name || "",
      ).trim();
      const access_token = issueSupplierAccessToken({
        supplier,
        onboarding: onboarding || undefined,
      });
      res.status(200).json({ ...result, access_token });
      return;
    }

    if (action === "portal-access-token" && req.method === "POST") {
      const body = await readJsonBody(req);
      const session_token = extractPortalSessionToken(body, req.headers);
      if (!session_token) {
        res.status(401).json({
          success: false,
          error:
            "Not authenticated. Please sign in again to the Supplier Portal.",
        });
        return;
      }
      const profile = await portalGetProfile(session_token);
      const supplier = stripWrappingQuotes(
        String(
          (profile as { linked_supplier?: string; company_name?: string })
            .linked_supplier ||
            (profile as { company_name?: string }).company_name ||
            "",
        ),
      );
      if (!supplier) {
        res.status(403).json({
          success: false,
          error: "Supplier identity missing from portal session.",
        });
        return;
      }
      const onboarding = String(
        (profile as { record?: { name?: string } }).record?.name || "",
      ).trim();
      const access_token = issueSupplierAccessToken({
        supplier,
        onboarding: onboarding || undefined,
      });
      res.status(200).json({ success: true, access_token, supplier });
      return;
    }

    if (action === "legacy-pin-token" && req.method === "POST") {
      if (!isLegacyPinProfileEnabledServer()) {
        console.error("[supplier-onboarding] legacy-pin-token denied: legacy PIN disabled");
        res.status(403).json({ success: false, error: "Legacy PIN profile is disabled." });
        return;
      }
      const body = await readJsonBody(req);
      const supplier = stripWrappingQuotes(String(body.supplier_name || ""));
      const pin = String(body.pin || "").trim();
      const fwd = req.headers["x-forwarded-for"];
      const ip =
        (Array.isArray(fwd) ? fwd[0] : String(fwd || "").split(",")[0]?.trim()) ||
        String(req.headers["x-real-ip"] || "") ||
        "";
      if (!supplier) {
        res.status(400).json({ success: false, error: "supplier_name is required." });
        return;
      }
      await portalAuthenticatePin({
        supplier_name: supplier,
        pin,
        client: {
          ...asPlainObject(body.client),
          ip: ip || undefined,
          user_agent: String(req.headers["user-agent"] || ""),
        },
      });
      const access_token = issueSupplierAccessToken({ supplier });
      res.status(200).json({ success: true, access_token, supplier });
      return;
    }

    if (action === "portal-forgot-password" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await portalForgotPassword(body as never);
      res.status(200).json(result);
      return;
    }

    if (action === "portal-reset-password-otp" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await portalResetPasswordWithOtp(body as never);
      res.status(200).json(result);
      return;
    }

    if (action === "portal-change-password" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await portalChangePassword({
        session_token: extractPortalSessionToken(body, req.headers),
        current_password: String(body.current_password ?? ""),
        new_password: String(body.new_password ?? ""),
      });
      res.status(200).json(result);
      return;
    }

    if (action === "portal-security" && req.method === "POST") {
      const body = await readJsonBody(req);
      const session_token = extractPortalSessionToken(body, req.headers) || undefined;
      let supplier_name = String(body.supplier_name || "").trim() || undefined;
      // PIN sessions authenticate via supplier access token (no portal session_token).
      if (!session_token) {
        const principal = requireSupplierAuth(req.headers as Record<string, unknown>, body);
        supplier_name = String(principal.supplier || supplier_name || "").trim();
      }
      const result = await portalGetSecurity({ session_token, supplier_name });
      res.status(200).json(result);
      return;
    }

    if (action === "portal-change-pin" && req.method === "POST") {
      const body = await readJsonBody(req);
      const session_token = extractPortalSessionToken(body, req.headers) || undefined;
      let supplier_name = String(body.supplier_name || "").trim() || undefined;
      if (!session_token) {
        const principal = requireSupplierAuth(req.headers as Record<string, unknown>, body);
        supplier_name = String(principal.supplier || supplier_name || "").trim();
        if (
          body.supplier_name &&
          String(body.supplier_name).trim() !== supplier_name
        ) {
          throw new RbacError("You can only modify your own credentials.", 403);
        }
      }
      const result = await portalChangePin({
        session_token,
        supplier_name,
        current_pin: String(body.current_pin ?? ""),
        new_pin: String(body.new_pin ?? ""),
      });
      res.status(200).json(result);
      return;
    }

    if (action === "portal-logout-others" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await portalLogoutOtherSessions({
        session_token: extractPortalSessionToken(body, req.headers),
      });
      res.status(200).json(result);
      return;
    }

    if (action === "portal-profile" && req.method === "POST") {
      const body = await readJsonBody(req);
      const session_token = extractPortalSessionToken(body, req.headers);
      const result = await portalGetProfile(session_token);
      res.status(200).json(result);
      return;
    }

    if (action === "portal-save-draft" && req.method === "POST") {
      const body = await readJsonBody(req);
      const session_token = extractPortalSessionToken(body, req.headers);
      const result = await portalSaveDraft({
        session_token,
        values: asPlainObject(body.values),
        form_data_fields: asPlainObject(body.form_data_fields),
        documents: asDocumentUploads(body.documents),
      });
      res.status(200).json(result);
      return;
    }

    if (action === "portal-submit" && req.method === "POST") {
      const body = await readJsonBody(req);
      const session_token = extractPortalSessionToken(body, req.headers);
      const result = await portalSubmit({
        session_token,
        values: asPlainObject(body.values),
        form_data_fields: asPlainObject(body.form_data_fields),
      });
      res.status(200).json(result);
      return;
    }

    if (action === "portal-comment" && req.method === "POST") {
      const body = await readJsonBody(req);
      const session_token = extractPortalSessionToken(body, req.headers);
      const result = await portalAddComment({
        session_token,
        text: String(body.text ?? ""),
        file_url: readStringField(body, "file_url"),
        file_name: readStringField(body, "file_name"),
        section_tag: readStringField(body, "section_tag"),
      });
      res.status(200).json(result);
      return;
    }

    if (action === "discussion-list" && req.method === "POST") {
      const body = await readJsonBody(req);
      const session_token = extractPortalSessionToken(body, req.headers);
      const result = await listDiscussion({
        name: body.name as string | undefined,
        session_token: session_token || (body.session_token as string | undefined),
        viewer: (body.viewer as "supplier" | "procurement") || "procurement",
      });
      res.status(200).json(result);
      return;
    }

    if (action === "discussion-send" && req.method === "POST") {
      const body = await readJsonBody(req);
      const session_token = extractPortalSessionToken(body, req.headers);
      const result = await addDiscussionMessage({
        name: readStringField(body, "name"),
        session_token:
          session_token || readStringField(body, "session_token"),
        viewer: body.viewer === "supplier" ? "supplier" : "procurement",
        text: String(body.text ?? ""),
        actor: readStringField(body, "actor"),
        section_tag: readStringField(body, "section_tag"),
        file_url: readStringField(body, "file_url"),
        file_name: readStringField(body, "file_name"),
      });
      res.status(200).json(result);
      return;
    }

    if (action === "discussion-mark-read" && req.method === "POST") {
      const body = await readJsonBody(req);
      const session_token = extractPortalSessionToken(body, req.headers);
      const result = await markDiscussionRead({
        name: body.name as string | undefined,
        session_token: session_token || (body.session_token as string | undefined),
        viewer: (body.viewer as "supplier" | "procurement") || "procurement",
      });
      res.status(200).json(result);
      return;
    }

    if (action === "discussion-resolve" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await resolveDiscussionMessage(body as never);
      res.status(200).json(result);
      return;
    }

    // TEMPORARY LEGACY MODE — PIN suppliers without onboarding drafts
    if (action === "legacy-pin-profile" && req.method === "POST") {
      if (!isLegacyPinProfileEnabledServer()) {
        res.status(403).json({
          success: false,
          error: "Legacy PIN profile access is disabled. Use Account Login.",
        });
        return;
      }
      const body = await readJsonBody(req);
      const result = await legacyPinGetProfile(body as never);
      res.status(200).json(result);
      return;
    }

    if (action === "legacy-pin-save" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await legacyPinSaveProfile(body as never);
      res.status(200).json(result);
      return;
    }

    if (action === "legacy-pin-resolve-upload" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await legacyPinResolveUpload(body as never);
      res.status(200).json(result);
      return;
    }

    if (action === "legacy-pin-discussion-list" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await legacyPinListDiscussion(body as never);
      res.status(200).json(result);
      return;
    }

    if (action === "legacy-pin-discussion-send" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await legacyPinSendDiscussion(body as never);
      res.status(200).json(result);
      return;
    }

    if (action === "legacy-pin-discussion-mark-read" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await legacyPinMarkDiscussionRead(body as never);
      res.status(200).json(result);
      return;
    }

    if (action === "request-changes" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await requestChanges(body as never);
      res.status(200).json(result);
      return;
    }

    if (action === "reject" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await rejectOnboarding(body as never);
      res.status(200).json(result);
      return;
    }

    if (action === "approve-stage" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await approveStage(body as never);
      res.status(200).json(result);
      return;
    }

    res.status(404).json({ success: false, error: `Unknown action: ${action || "(none)"}` });
  } catch (err) {
    if (err instanceof RbacError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    const friendly = toFriendlyOnboardingError(err);
    res.status(friendly.status).json({ success: false, error: friendly.message });
  }
}
