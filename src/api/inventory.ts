/**
 * Inventory service — Item master creation with ERPNext field metadata.
 */
import type { AxiosError } from "axios";

import { apiGet, apiPost, buildResourceUrl, withSilent } from "./erpnext";
import type { Item } from "../types/erpnext";

const ITEM_DOCTYPE = "Item";
const GST_HSN_DOCTYPE = "GST HSN Code";

export const HSN_CREATION_ERROR_MESSAGE =
  "Unable to create HSN Code. Please contact administrator.";

/** Known HSN field names across ERPNext / India Compliance setups. */
export const HSN_FIELD_CANDIDATES = [
  "gst_hsn_code",
  "hsn_code",
  "gst_hsn",
  "custom_hsn_code",
] as const;

export interface ItemHsnFieldConfig {
  fieldname: string;
  required: boolean;
  label: string;
  fieldtype: string;
}

export interface CreateItemInput {
  item_code: string;
  item_name: string;
  item_group: string;
  stock_uom: string;
  gst_hsn_code?: string;
  description?: string;
  is_stock_item?: 0 | 1;
}

interface DocFieldRow {
  fieldname: string;
  reqd?: 0 | 1;
  label?: string;
  fieldtype?: string;
}

let cachedHsnConfig: ItemHsnFieldConfig | undefined;

const DEFAULT_HSN_CONFIG: ItemHsnFieldConfig = {
  fieldname: "gst_hsn_code",
  required: true,
  label: "HSN/SAC Code",
  fieldtype: "Link",
};

function inventoryLog(label: string, payload: unknown) {
  // eslint-disable-next-line no-console
  console.log(`[Inventory] ${label}`, payload);
}

function inventoryError(label: string, payload: unknown) {
  // eslint-disable-next-line no-console
  console.error(`[Inventory] ${label}`, payload);
}

/**
 * Read Item DocType metadata from ERPNext DocField rows to learn which HSN
 * field exists and whether it is mandatory (`reqd = 1`).
 */
export async function getItemHsnFieldConfig(): Promise<ItemHsnFieldConfig> {
  if (cachedHsnConfig !== undefined) return cachedHsnConfig;

  try {
    const rows = await apiGet<DocFieldRow[]>(
      "/api/resource/DocField",
      withSilent({
        params: {
          filters: JSON.stringify([
            ["parent", "=", ITEM_DOCTYPE],
            ["fieldname", "in", [...HSN_FIELD_CANDIDATES]],
          ]),
          fields: JSON.stringify(["fieldname", "reqd", "label", "fieldtype"]),
          limit_page_length: HSN_FIELD_CANDIDATES.length,
        },
      })
    );

    inventoryLog("Item HSN DocField metadata", rows);

    const byName = new Map(rows.map((row) => [row.fieldname, row]));

    let mandatory: DocFieldRow | undefined;
    for (const name of HSN_FIELD_CANDIDATES) {
      const row = byName.get(name);
      if (row?.reqd === 1) {
        mandatory = row;
        break;
      }
    }

    const chosen = mandatory ?? HSN_FIELD_CANDIDATES.map((n) => byName.get(n)).find(Boolean);

    if (chosen) {
      cachedHsnConfig = {
        fieldname: chosen.fieldname,
        required: chosen.reqd === 1,
        label: chosen.label ?? "HSN/SAC Code",
        fieldtype: chosen.fieldtype ?? "Data",
      };
      inventoryLog("Resolved Item HSN field config", cachedHsnConfig);
      return cachedHsnConfig;
    }

    inventoryLog(
      "No HSN DocField rows found — using India GST default",
      DEFAULT_HSN_CONFIG
    );
    cachedHsnConfig = DEFAULT_HSN_CONFIG;
    return cachedHsnConfig;
  } catch (err) {
    inventoryError("Item HSN DocField metadata fetch failed", err);
    cachedHsnConfig = DEFAULT_HSN_CONFIG;
    return cachedHsnConfig;
  }
}

export function isHsnMandatoryError(message: string): boolean {
  return (
    /MandatoryError/i.test(message) ||
    (/HSN|SAC/i.test(message) &&
      (/required|mandatory|enter a valid/i.test(message) ||
        /MandatoryError/i.test(message)))
  );
}

export function friendlyHsnMandatoryMessage(): string {
  return "ERPNext requires an HSN/SAC Code for this item.";
}

function normalizeItemCreationError(err: unknown): Error {
  const message =
    err instanceof Error ? err.message : "Could not create item.";
  if (isHsnMandatoryError(message)) {
    return new Error(friendlyHsnMandatoryMessage());
  }
  return err instanceof Error ? err : new Error(message);
}

function isAxiosNotFound(err: unknown): boolean {
  const axiosErr = err as AxiosError;
  if (axiosErr.response?.status === 404) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /does not exist|not found|404/i.test(message);
}

function isDuplicateHsnError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const axiosErr = err as AxiosError<{ exc_type?: string }>;
  return (
    /duplicate|already exists|DuplicateEntryError/i.test(message) ||
    axiosErr.response?.data?.exc_type === "DuplicateEntryError"
  );
}

/** Ensure a GST HSN Code master exists before linking it on an Item. */
async function ensureGstHsnCodeExists(hsnCode: string): Promise<void> {
  const code = hsnCode.trim();
  if (!code) return;

  try {
    const lookup = await apiGet(
      buildResourceUrl(GST_HSN_DOCTYPE, code),
      withSilent()
    );
    inventoryLog("HSN lookup response", lookup);
    return;
  } catch (err) {
    inventoryLog("HSN lookup response", {
      status: (err as AxiosError).response?.status,
      message: err instanceof Error ? err.message : err,
      data: (err as AxiosError).response?.data,
    });

    if (!isAxiosNotFound(err)) {
      throw err;
    }
  }

  const hsnPayload = {
    doctype: GST_HSN_DOCTYPE,
    name: code,
    hsn_code: code,
    description: "Auto-created by Netlink",
  };

  try {
    const created = await apiPost(
      buildResourceUrl(GST_HSN_DOCTYPE),
      hsnPayload,
      withSilent()
    );
    inventoryLog("HSN creation response", created);
  } catch (err) {
    if (isDuplicateHsnError(err)) {
      inventoryLog("HSN creation response", {
        skipped: true,
        reason: "already exists",
      });
      return;
    }

    inventoryError("HSN creation response", {
      message: err instanceof Error ? err.message : err,
      data: (err as AxiosError).response?.data,
    });
    throw new Error(HSN_CREATION_ERROR_MESSAGE);
  }
}

/** Create an Item using the HSN field name resolved from ERPNext metadata. */
export async function createInventoryItem(
  input: CreateItemInput
): Promise<Item> {
  const hsnConfig = await getItemHsnFieldConfig();
  const hsnValue = input.gst_hsn_code?.trim() ?? "";

  if (hsnValue) {
    await ensureGstHsnCodeExists(hsnValue);
  }

  const payload: Record<string, unknown> = {
    item_code: input.item_code.trim(),
    item_name: input.item_name.trim(),
    item_group: input.item_group.trim() || "All Item Groups",
    stock_uom: input.stock_uom.trim() || "Nos",
    is_stock_item: input.is_stock_item ?? 1,
  };

  if (hsnValue) {
    payload[hsnConfig.fieldname] = hsnValue;
  }

  if (input.description?.trim()) {
    payload.description = input.description.trim();
  }

  inventoryLog("createItem → request payload", {
    fieldname: hsnConfig.fieldname,
    required: hsnConfig.required,
    payload,
  });

  try {
    const created = await apiPost<Item>(
      buildResourceUrl(ITEM_DOCTYPE),
      payload,
      withSilent()
    );
    inventoryLog("Item creation response", created);
    return created;
  } catch (err) {
    const axiosErr = err as AxiosError<{ exc_type?: string; exception?: string }>;
    inventoryError("Item creation response", {
      message: err instanceof Error ? err.message : err,
      exc_type: axiosErr.response?.data?.exc_type,
      exception: axiosErr.response?.data?.exception,
      response: axiosErr.response?.data,
    });
    throw normalizeItemCreationError(err);
  }
}
