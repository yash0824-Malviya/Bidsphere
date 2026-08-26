import { describe, expect, it, vi } from "vitest";
import {
  assertNoGenericFileAccess,
  authorizePersistedFileRead,
  authorizeFileResourceRequest,
  exactFileAttachmentScope,
  fileResourceRoute,
} from "./fileResourceGuard";
import type { AccessPrincipal, AppRole } from "./rbacAuth";

function internal(
  role: AppRole = "engineer",
  email = "engineer@netlink.com",
): Extract<AccessPrincipal, { typ: "internal" }> {
  return {
    typ: "internal",
    sub: email,
    email,
    role,
    iat: Date.now(),
    exp: Date.now() + 60_000,
  };
}

function supplier(name = "SUP-001"): Extract<AccessPrincipal, { typ: "supplier" }> {
  return {
    typ: "supplier",
    sub: `supplier:${name}`,
    supplier: name,
    iat: Date.now(),
    exp: Date.now() + 60_000,
  };
}

function ecrLoader(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (doctype: string) => {
    if (doctype === "File") {
      return {
        name: "FILE-001",
        attached_to_doctype: "Engineering Change Request",
        attached_to_name: "ECR-2026-100001",
        attached_to_field: "engineering_drawing",
        is_private: 1,
        ...overrides,
      };
    }
    if (doctype === "Engineering Change Request") {
      return {
        name: "ECR-2026-100001",
        select_pxfp: "Draft",
        ecr_owner: "engineer@netlink.com",
      };
    }
    throw new Error(`Unexpected ${doctype}`);
  });
}

describe("File resource authorization", () => {
  it("recognizes collection and decoded named File routes", () => {
    expect(fileResourceRoute("resource/File")).toEqual({
      isFileResource: true,
      isCollection: true,
      name: "",
    });
    expect(fileResourceRoute("resource/File/FILE%20001")).toEqual({
      isFileResource: true,
      isCollection: false,
      name: "FILE 001",
    });
    expect(fileResourceRoute("resource/Item/ITEM-1").isFileResource).toBe(false);
  });

  it("requires exact attachment filters and denies every File collection write", async () => {
    expect(exactFileAttachmentScope(JSON.stringify([
      ["attached_to_doctype", "=", "Engineering Change Request"],
      ["attached_to_name", "=", "ECR-2026-100001"],
    ]))).toEqual({
      doctype: "Engineering Change Request",
      docname: "ECR-2026-100001",
    });
    expect(exactFileAttachmentScope(JSON.stringify([
      ["attached_to_doctype", "=", "Engineering Change Request"],
    ]))).toBeNull();

    const loadDocument = vi.fn();
    await expect(authorizeFileResourceRequest({
      apiPath: "resource/File",
      method: "GET",
      principal: internal("admin"),
      query: {},
      loadDocument,
    })).rejects.toThrow(/exact attached_to_doctype and attached_to_name/i);

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      await expect(authorizeFileResourceRequest({
        apiPath: "resource/File",
        method,
        principal: internal("admin"),
        loadDocument,
      })).rejects.toThrow(/collection writes are disabled/i);
    }
    expect(loadDocument).not.toHaveBeenCalled();

    await expect(authorizeFileResourceRequest({
      apiPath: "resource/File",
      method: "GET",
      principal: internal("admin"),
      query: { filters: ["[]", "[]"] },
      loadDocument,
    })).rejects.toThrow(/duplicate File collection filters/i);
  });

  it("denies generic File reads and mutations outside the scoped resource guard", () => {
    expect(() => assertNoGenericFileAccess(
      "method/frappe.client.get_list",
      ["File"],
    )).toThrow(/generic ERP methods are disabled for File/i);
    expect(() => assertNoGenericFileAccess(
      "method/frappe.client.insert",
      ["File", "Business Need"],
    )).toThrow(/generic ERP methods are disabled for File/i);
    expect(() => assertNoGenericFileAccess(
      "method/frappe.client.get_list",
      ["Item"],
    )).not.toThrow();
  });

  it("authorizes an ECR-scoped File list against the ECR owner", async () => {
    const filters = JSON.stringify([
      ["attached_to_doctype", "=", "Engineering Change Request"],
      ["attached_to_name", "=", "ECR-2026-100001"],
    ]);
    const loadDocument = ecrLoader();

    await expect(authorizeFileResourceRequest({
      apiPath: "resource/File",
      method: "GET",
      principal: internal(),
      query: { filters },
      loadDocument,
    })).resolves.toBeNull();
    await expect(authorizeFileResourceRequest({
      apiPath: "resource/File",
      method: "GET",
      principal: internal("engineer", "other@netlink.com"),
      query: { filters },
      loadDocument,
    })).rejects.toThrow(/only files on their own ECRs/i);
  });

  it.each(["GET", "HEAD", "PUT", "PATCH", "DELETE"])(
    "loads the persisted File and ECR before deciding a named %s",
    async (method) => {
      const loadDocument = ecrLoader();
      const result = authorizeFileResourceRequest({
        apiPath: "resource/File/FILE-001",
        method,
        principal: internal(),
        body: method === "PUT" || method === "PATCH" ? { file_name: "renamed.pdf" } : undefined,
        loadDocument,
      });
      if (method === "PUT" || method === "PATCH") {
        await expect(result).rejects.toThrow(/metadata cannot be changed directly/i);
      } else {
        await expect(result).resolves.toMatchObject({ name: "FILE-001" });
      }
      expect(loadDocument).toHaveBeenNthCalledWith(1, "File", "FILE-001");
      expect(loadDocument).toHaveBeenNthCalledWith(
        2,
        "Engineering Change Request",
        "ECR-2026-100001",
      );
    },
  );

  it("enforces ECR owner, stage, and attachment field for named File access", async () => {
    await expect(authorizeFileResourceRequest({
      apiPath: "resource/File/FILE-001",
      method: "GET",
      principal: supplier(),
      loadDocument: ecrLoader(),
    })).rejects.toThrow(/internal authentication required/i);

    await expect(authorizeFileResourceRequest({
      apiPath: "resource/File/FILE-001",
      method: "GET",
      principal: internal("engineer", "other@netlink.com"),
      loadDocument: ecrLoader(),
    })).rejects.toThrow(/own ECRs/i);

    const approvedLoader = vi.fn(async (doctype: string) => doctype === "File"
      ? {
          name: "FILE-001",
          attached_to_doctype: "Engineering Change Request",
          attached_to_name: "ECR-2026-100001",
          attached_to_field: "engineering_drawing",
        }
      : {
          name: "ECR-2026-100001",
          select_pxfp: "Engineering Review",
          ecr_owner: "engineer@netlink.com",
        });
    await expect(authorizeFileResourceRequest({
      apiPath: "resource/File/FILE-001",
      method: "DELETE",
      principal: internal(),
      loadDocument: approvedLoader,
    })).rejects.toThrow(/Draft or Sent Back/i);

    await expect(authorizeFileResourceRequest({
      apiPath: "resource/File/FILE-001",
      method: "DELETE",
      principal: internal(),
      loadDocument: ecrLoader({ attached_to_field: "select_pxfp" }),
    })).rejects.toThrow(/attachment field is not authorized/i);

    await expect(authorizeFileResourceRequest({
      apiPath: "resource/File/FILE-001",
      method: "GET",
      principal: internal(),
      loadDocument: ecrLoader({ attached_to_field: "" }),
    })).rejects.toThrow(/attachment field is not authorized/i);
  });

  it("keeps non-ECR named Files authenticated and supplier-scoped", async () => {
    const loadDocument = vi.fn(async (doctype: string, name: string) => {
      if (doctype === "File") {
        return {
          name: "FILE-SQ",
          attached_to_doctype: "Supplier Quotation",
          attached_to_name: "SQ-001",
        };
      }
      if (doctype === "Supplier Quotation" && name === "SQ-001") {
        return { name, supplier: "SUP-001" };
      }
      if (doctype === "RFP Response" && name === "RFPR-001") {
        return { name, supplier: "SUP-001" };
      }
      throw new Error(`Unexpected ${doctype} ${name}`);
    });

    await expect(authorizeFileResourceRequest({
      apiPath: "resource/File/FILE-SQ",
      method: "GET",
      principal: supplier(),
      loadDocument,
    })).resolves.toMatchObject({ name: "FILE-SQ" });
    await expect(authorizeFileResourceRequest({
      apiPath: "resource/File/FILE-SQ",
      method: "GET",
      principal: supplier("SUP-OTHER"),
      loadDocument,
    })).rejects.toThrow(/not assigned/i);
    await expect(authorizeFileResourceRequest({
      apiPath: "resource/File/FILE-SQ",
      method: "PATCH",
      principal: supplier(),
      body: {
        attached_to_doctype: "RFP Response",
        attached_to_name: "RFPR-001",
      },
      loadDocument,
    })).resolves.toMatchObject({ name: "FILE-SQ" });
  });

  it("blocks relinking an ordinary File onto an ECR", async () => {
    const loadDocument = vi.fn(async (doctype: string) => doctype === "File"
      ? {
          name: "FILE-OTHER",
          attached_to_doctype: "Item",
          attached_to_name: "ITEM-001",
        }
      : { name: "ITEM-001" });

    await expect(authorizeFileResourceRequest({
      apiPath: "resource/File/FILE-OTHER",
      method: "PATCH",
      principal: internal("admin"),
      body: {
        attached_to_doctype: "Engineering Change Request",
        attached_to_name: "ECR-2026-100001",
      },
      loadDocument,
    })).rejects.toThrow(/cannot be relinked directly/i);
    expect(loadDocument).toHaveBeenCalledWith("File", "FILE-OTHER");
  });

  it("blocks alternate File mutation envelopes before they can hide a relink", async () => {
    const loadDocument = vi.fn(async () => ({
      name: "FILE-OTHER",
      attached_to_doctype: "Item",
      attached_to_name: "ITEM-001",
    }));
    await expect(authorizeFileResourceRequest({
      apiPath: "resource/File/FILE-OTHER",
      method: "PUT",
      principal: internal("admin"),
      body: {
        data: {
          attached_to_doctype: "Engineering Change Request",
          attached_to_name: "ECR-2026-100001",
        },
      },
      loadDocument,
    })).rejects.toThrow(/wrapped File mutation payloads/i);
    expect(loadDocument).toHaveBeenCalledWith("File", "FILE-OTHER");
  });

  it("authorizes exact persisted byte-download metadata against its parent", async () => {
    const file = {
      name: "FILE-001",
      file_url: "/private/files/drawing.pdf",
      attached_to_doctype: "Engineering Change Request",
      attached_to_name: "ECR-2026-100001",
      attached_to_field: "engineering_drawing",
    };
    await expect(authorizePersistedFileRead({
      principal: internal(),
      file,
      loadDocument: ecrLoader(),
    })).resolves.toBeUndefined();
    await expect(authorizePersistedFileRead({
      principal: internal("engineer", "other@netlink.com"),
      file,
      loadDocument: ecrLoader(),
    })).rejects.toThrow(/own ECRs/i);
    await expect(authorizePersistedFileRead({
      principal: supplier(),
      file,
      supplierContextAuthorized: true,
      loadDocument: ecrLoader(),
    })).rejects.toThrow(/internal authentication required/i);
  });

  it("requires supplier RFQ context or ownership for persisted non-ECR bytes", async () => {
    const file = {
      name: "FILE-RFQ",
      file_url: "/private/files/rfq.pdf",
      attached_to_doctype: "Request for Quotation",
      attached_to_name: "RFQ-001",
    };
    const ownedLoader = vi.fn(async () => ({
      name: "RFQ-001",
      suppliers: [{ supplier: "SUP-001" }],
    }));
    await expect(authorizePersistedFileRead({
      principal: supplier(),
      file,
      loadDocument: ownedLoader,
    })).resolves.toBeUndefined();
    await expect(authorizePersistedFileRead({
      principal: supplier("SUP-OTHER"),
      file,
      loadDocument: ownedLoader,
    })).rejects.toThrow(/not assigned/i);

    const noLoad = vi.fn();
    await expect(authorizePersistedFileRead({
      principal: supplier("SUP-OTHER"),
      file,
      supplierContextAuthorized: true,
      loadDocument: noLoad,
    })).resolves.toBeUndefined();
    expect(noLoad).not.toHaveBeenCalled();
  });
});
