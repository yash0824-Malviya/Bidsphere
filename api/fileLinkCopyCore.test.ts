import { describe, expect, it, vi } from "vitest";
import {
  copyBusinessNeedFileToCaseCore,
  FileLinkCopyError,
  type FileLinkCopyDependencies,
  type InternalFileLinkPrincipal,
  type PersistedFileLink,
} from "./fileLinkCopyCore";
import type { AppRole } from "./rbacAuth";

const SOURCE_FILE: PersistedFileLink = {
  name: "FILE-BN-001",
  file_name: "technical-specification.pdf",
  file_url: "/private/files/technical-specification.pdf",
  file_size: 4096,
  is_private: 1,
  is_folder: 0,
  folder: "Home/Attachments",
  content_hash: "sha256-source",
  attached_to_doctype: "Business Need",
  attached_to_name: "BN-2026-00001",
};

const TARGET_FILE: PersistedFileLink = {
  ...SOURCE_FILE,
  name: "FILE-BC-001",
  attached_to_doctype: "Business Case",
  attached_to_name: "BC-2026-00001",
};

function principal(
  role: AppRole = "department",
  email = "department@netlink.com",
): InternalFileLinkPrincipal {
  return {
    typ: "internal",
    sub: email,
    email,
    role,
    iat: Date.now(),
    exp: Date.now() + 60_000,
  };
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source_file_name: SOURCE_FILE.name,
    target_doctype: "Business Case",
    target_docname: "BC-2026-00001",
    ...overrides,
  };
}

function dependencies(input: {
  sourceFile?: PersistedFileLink;
  sourceNeed?: Record<string, unknown>;
  targetCase?: Record<string, unknown>;
  targetLookups?: PersistedFileLink[][];
  insertError?: Error;
} = {}): FileLinkCopyDependencies {
  const sourceFile = input.sourceFile ?? SOURCE_FILE;
  const sourceNeed = input.sourceNeed ?? {
    name: "BN-2026-00001",
    requester: "department@netlink.com",
  };
  const targetCase = input.targetCase ?? {
    name: "BC-2026-00001",
    business_need: "BN-2026-00001",
  };
  const targetLookups = [...(input.targetLookups ?? [[], [TARGET_FILE]])];
  return {
    loadDocument: vi.fn(async (doctype: string) => {
      if (doctype === "File") return sourceFile;
      if (doctype === "Business Need") return sourceNeed;
      if (doctype === "Business Case") return targetCase;
      throw new Error(`Unexpected DocType ${doctype}`);
    }),
    findTargetLinks: vi.fn(async () => targetLookups.shift() ?? []),
    insertTargetLink: vi.fn(async () => {
      if (input.insertError) throw input.insertError;
      return TARGET_FILE;
    }),
  };
}

describe("copyBusinessNeedFileToCaseCore", () => {
  it("loads both parents and creates a link using only persisted source metadata", async () => {
    const deps = dependencies();

    const result = await copyBusinessNeedFileToCaseCore({
      payload: payload(),
      principal: principal(),
    }, deps);

    expect(result).toMatchObject({
      created: true,
      source_file_name: "FILE-BN-001",
      target_doctype: "Business Case",
      target_docname: "BC-2026-00001",
      file: { name: "FILE-BC-001" },
    });
    expect(deps.loadDocument).toHaveBeenNthCalledWith(1, "File", "FILE-BN-001");
    expect(deps.loadDocument).toHaveBeenNthCalledWith(2, "Business Need", "BN-2026-00001");
    expect(deps.loadDocument).toHaveBeenNthCalledWith(3, "Business Case", "BC-2026-00001");
    expect(deps.insertTargetLink).toHaveBeenCalledWith({
      file_name: "technical-specification.pdf",
      file_url: "/private/files/technical-specification.pdf",
      file_size: 4096,
      is_private: 1,
      is_folder: 0,
      folder: "Home/Attachments",
      content_hash: "sha256-source",
      attached_to_doctype: "Business Case",
      attached_to_name: "BC-2026-00001",
    });
    expect(deps.findTargetLinks).toHaveBeenCalledTimes(2);
  });

  it("returns the one exact persisted link on an idempotent replay", async () => {
    const deps = dependencies({ targetLookups: [[TARGET_FILE]] });

    const result = await copyBusinessNeedFileToCaseCore({
      payload: payload(),
      principal: principal("finance"),
    }, deps);

    expect(result.created).toBe(false);
    expect(result.file.name).toBe("FILE-BC-001");
    expect(deps.insertTargetLink).not.toHaveBeenCalled();
  });

  it("treats a committed insert whose response was lost as a replay", async () => {
    const deps = dependencies({
      targetLookups: [[], [TARGET_FILE]],
      insertError: new Error("socket closed before response"),
    });

    const result = await copyBusinessNeedFileToCaseCore({
      payload: payload(),
      principal: principal("procurement"),
    }, deps);

    expect(result.created).toBe(false);
    expect(result.file.name).toBe("FILE-BC-001");
    expect(deps.findTargetLinks).toHaveBeenCalledTimes(2);
  });

  it("fails closed when more than one target link matches", async () => {
    const deps = dependencies({
      targetLookups: [[
        TARGET_FILE,
        { ...TARGET_FILE, name: "FILE-BC-DUPLICATE" },
      ]],
    });

    await expect(copyBusinessNeedFileToCaseCore({
      payload: payload(),
      principal: principal("legal"),
    }, deps)).rejects.toMatchObject<FileLinkCopyError>({
      status: 409,
      code: "conflict",
    });
    expect(deps.insertTargetLink).not.toHaveBeenCalled();
  });

  it("rejects client-supplied File metadata before loading ERPNext", async () => {
    const deps = dependencies();

    await expect(copyBusinessNeedFileToCaseCore({
      payload: payload({
        file_url: "/files/forged.pdf",
        is_private: 0,
      }),
      principal: principal(),
    }, deps)).rejects.toMatchObject<FileLinkCopyError>({
      status: 422,
      code: "validation",
      fieldErrors: {
        file_url: expect.stringMatching(/not accepted/i),
        is_private: expect.stringMatching(/not accepted/i),
      },
    });
    expect(deps.loadDocument).not.toHaveBeenCalled();
  });

  it("forbids ECR targets and ECR source files", async () => {
    const targetDeps = dependencies();
    await expect(copyBusinessNeedFileToCaseCore({
      payload: payload({ target_doctype: "Engineering Change Request" }),
      principal: principal("admin"),
    }, targetDeps)).rejects.toMatchObject<FileLinkCopyError>({
      status: 403,
      code: "forbidden",
    });
    expect(targetDeps.loadDocument).not.toHaveBeenCalled();

    const sourceDeps = dependencies({
      sourceFile: {
        ...SOURCE_FILE,
        attached_to_doctype: "Engineering Change Request",
        attached_to_name: "ECR-2026-00001",
      },
    });
    await expect(copyBusinessNeedFileToCaseCore({
      payload: payload(),
      principal: principal("admin"),
    }, sourceDeps)).rejects.toMatchObject<FileLinkCopyError>({
      status: 403,
      code: "forbidden",
    });
    expect(sourceDeps.loadDocument).toHaveBeenCalledTimes(1);
  });

  it("rejects an unrelated Business Case and another department user's need", async () => {
    const unrelated = dependencies({
      targetCase: {
        name: "BC-2026-00001",
        business_need: "BN-OTHER",
      },
    });
    await expect(copyBusinessNeedFileToCaseCore({
      payload: payload(),
      principal: principal("finance"),
    }, unrelated)).rejects.toMatchObject<FileLinkCopyError>({
      status: 403,
      code: "forbidden",
    });

    const anotherOwner = dependencies({
      sourceNeed: {
        name: "BN-2026-00001",
        requester: "another-department@netlink.com",
      },
    });
    await expect(copyBusinessNeedFileToCaseCore({
      payload: payload(),
      principal: principal("department"),
    }, anotherOwner)).rejects.toMatchObject<FileLinkCopyError>({
      status: 403,
      code: "forbidden",
    });
    expect(anotherOwner.loadDocument).toHaveBeenCalledTimes(2);
  });

  it("rejects non-Intake roles and inconsistent source privacy metadata", async () => {
    const denied = dependencies();
    await expect(copyBusinessNeedFileToCaseCore({
      payload: payload(),
      principal: principal("engineer"),
    }, denied)).rejects.toThrow(/permission/i);
    expect(denied.loadDocument).not.toHaveBeenCalled();

    const inconsistent = dependencies({
      sourceFile: {
        ...SOURCE_FILE,
        is_private: 0,
      },
    });
    await expect(copyBusinessNeedFileToCaseCore({
      payload: payload(),
      principal: principal("admin"),
    }, inconsistent)).rejects.toMatchObject<FileLinkCopyError>({
      status: 409,
      code: "conflict",
    });
    expect(inconsistent.loadDocument).toHaveBeenCalledTimes(1);
  });
});
