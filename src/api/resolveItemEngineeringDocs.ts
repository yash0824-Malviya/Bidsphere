/**
 * Resolve engineering attachment references for any procurement line item
 * without re-uploading files. Walks links back to MR / RFQ item rows.
 *
 * List queries only request always-safe child fields (`name`, `item_code`,
 * links, `description`). Custom engineering fields are read via get_doc on
 * the child name — list endpoints return HTTP 417 when custom fields are
 * missing or not permitted in query (e.g. `custom_part_name`).
 */

import {
  apiGet,
  buildListConfig,
  buildResourceUrl,
  withSilent,
} from "./erpnext";
import { extractSourceDepartmentMrName } from "./materialRequestWorkflow";
import {
  hydrateEngineeringDocsFromChild,
  pickEngineeringDocs,
  type EngineeringDocs,
} from "../utils/materialRequestItemFiles";

export type EngineeringDocsLookup = {
  item_code?: string | null;
  /** Direct Material Request Item child name. */
  material_request_item?: string | null;
  material_request?: string | null;
  /** Inline JSON / Attach fields when already present on the row. */
  custom_part_name?: string | null;
  custom_2d_drawing?: string | null;
  custom_engineering_attachments?: string | null;
  /** Purchase Order Item name — used from GRN / Invoice lines. */
  purchase_order_item?: string | null;
  purchase_order?: string | null;
  /** RFQ name hint (e.g. PO remarks). */
  rfq_name?: string | null;
};

type ChildRow = {
  name?: string;
  item_code?: string;
  material_request?: string;
  material_request_item?: string;
  custom_part_name?: string;
  custom_2d_drawing?: string;
  custom_engineering_attachments?: string;
  description?: string;
  remarks?: string;
};

/** Safe list fields — never include optional custom_* (417 if absent). */
const MR_ITEM_LIST_FIELDS = ["name", "item_code", "description"] as const;
const RFQ_ITEM_LIST_FIELDS = [
  "name",
  "item_code",
  "material_request",
  "material_request_item",
] as const;

const EMPTY: EngineeringDocs = { attachments: [] };

async function getChildDoc(
  doctype: string,
  name: string,
): Promise<ChildRow | null> {
  try {
    return await apiGet<ChildRow>(
      buildResourceUrl(doctype, name),
      withSilent({}),
    );
  } catch {
    return null;
  }
}

async function findRfqItemByCode(
  rfqName: string,
  itemCode: string,
): Promise<ChildRow | null> {
  try {
    const rows = await apiGet<ChildRow[]>(
      buildResourceUrl("Request for Quotation Item"),
      withSilent(
        buildListConfig({
          fields: [...RFQ_ITEM_LIST_FIELDS],
          filters: [
            ["parent", "=", rfqName],
            ["item_code", "=", itemCode],
          ],
          limit_page_length: 1,
        }),
      ),
    );
    const name = String(rows?.[0]?.name ?? "").trim();
    if (!name) return null;
    // Full child (optional custom engineering fields) via get_doc.
    return (await getChildDoc("Request for Quotation Item", name)) ?? rows[0];
  } catch {
    return null;
  }
}

/**
 * Resolve engineering attachment references for a linked line item.
 * Material Request Item is the owner / single source of truth.
 * Downstream docs only store URL references — never re-upload files.
 */
async function docsFromMrItemChild(
  mrItemName: string | null | undefined,
): Promise<EngineeringDocs> {
  const name = String(mrItemName || "").trim();
  if (!name) return EMPTY;
  const mrItem = await getChildDoc("Material Request Item", name);
  if (!mrItem) return EMPTY;
  // JSON + File DocType (same source Warehouse uses) — never re-upload.
  return hydrateEngineeringDocsFromChild({ ...mrItem, name });
}

function mergeEngineeringDocs(
  ...bundles: EngineeringDocs[]
): EngineeringDocs {
  const byUrl = new Map<
    string,
    EngineeringDocs["attachments"][number]
  >();
  let part_name: string | undefined;
  for (const bundle of bundles) {
    if (!part_name && bundle.part_name) part_name = bundle.part_name;
    for (const att of bundle.attachments) {
      const key = String(att.fileUrl || "").trim();
      if (!key || byUrl.has(key)) continue;
      byUrl.set(key, att);
    }
  }
  const attachments = [...byUrl.values()];
  return {
    part_name,
    drawing_2d_url: attachments[0]?.fileUrl,
    attachments,
  };
}

async function docsFromRfqItemChild(
  rfqName: string,
  itemCode: string,
): Promise<EngineeringDocs> {
  const rfqItem = await findRfqItemByCode(rfqName, itemCode);
  if (!rfqItem?.name) return EMPTY;
  const fromRfq = await hydrateEngineeringDocsFromChild(rfqItem, {
    attachedToDoctype: "Request for Quotation Item",
  });
  const fromMr = await docsFromMrItemChild(rfqItem.material_request_item);
  return mergeEngineeringDocs(fromRfq, fromMr);
}

export async function resolveItemEngineeringDocs(
  input: EngineeringDocsLookup,
): Promise<EngineeringDocs> {
  const itemCode = input.item_code?.trim();
  const rfqHint = input.rfq_name?.trim();

  // 1) RFQ Item row (supplier quotation lines) — primary for portal item cards.
  if (rfqHint && itemCode) {
    const fromRfqItem = await docsFromRfqItemChild(rfqHint, itemCode);
    const inline = pickEngineeringDocs(input);
    const mergedRfq = mergeEngineeringDocs(fromRfqItem, inline);
    if (mergedRfq.attachments.length > 0 || mergedRfq.part_name) {
      return mergedRfq;
    }
  }

  // 2) Material Request Item (owner) when linked.
  const fromMrItem = await docsFromMrItemChild(input.material_request_item);

  // 3) Inline reference JSON on the current row (RFQ/PO procurement add-ons).
  const inline = pickEngineeringDocs(input);
  const mergedPrimary = mergeEngineeringDocs(fromMrItem, inline);
  if (mergedPrimary.attachments.length > 0 || mergedPrimary.part_name) {
    return mergedPrimary;
  }

  // 3) Purchase Order Item → MR item / RFQ item.
  const poItemName = input.purchase_order_item?.trim();
  if (poItemName) {
    const poItem = await getChildDoc("Purchase Order Item", poItemName);
    if (poItem) {
      const fromPoInline = pickEngineeringDocs(poItem);
      if (fromPoInline.attachments.length > 0 || fromPoInline.part_name) {
        return fromPoInline;
      }
      const fromPoMr = await docsFromMrItemChild(poItem.material_request_item);
      if (fromPoMr.attachments.length > 0 || fromPoMr.part_name) {
        return fromPoMr;
      }
    }
  }

  // 4) PO header → RFQ name (often stored in remarks) → RFQ Item by item_code.
  const poName = input.purchase_order?.trim();
  if (poName && itemCode) {
    try {
      const po = await apiGet<{
        remarks?: string;
        custom_rfq_reference?: string;
        items?: ChildRow[];
      }>(buildResourceUrl("Purchase Order", poName), withSilent({}));

      // Prefer PO item with matching item_code for MR link.
      const poLine = (po.items ?? []).find((it) => it.item_code === itemCode);
      if (poLine?.material_request_item) {
        const docs = await docsFromMrItemChild(poLine.material_request_item);
        if (docs.attachments.length > 0 || docs.part_name) return docs;
      }
      const fromPoLine = pickEngineeringDocs(poLine);
      if (fromPoLine.attachments.length > 0 || fromPoLine.part_name) {
        return fromPoLine;
      }

      const rfqName = (
        input.rfq_name ||
        po.custom_rfq_reference ||
        po.remarks ||
        ""
      ).trim();
      if (rfqName) {
        const rfqItem = await findRfqItemByCode(rfqName, itemCode);
        const fromRfq = pickEngineeringDocs(rfqItem);
        if (fromRfq.attachments.length > 0 || fromRfq.part_name) return fromRfq;
        if (rfqItem?.material_request_item) {
          const docs = await docsFromMrItemChild(rfqItem.material_request_item);
          if (docs.attachments.length > 0 || docs.part_name) return docs;
        }
      }
    } catch {
      /* fall through */
    }
  }

  // 5) Explicit RFQ hint + item_code (full hydrate including File DocType).
  if (rfqHint && itemCode) {
    const fromRfqItem = await docsFromRfqItemChild(rfqHint, itemCode);
    if (fromRfqItem.attachments.length > 0 || fromRfqItem.part_name) {
      return fromRfqItem;
    }
  }

  // 6) When only material_request + item_code are known (no child name).
  const mrName = input.material_request?.trim();
  if (mrName && itemCode) {
    try {
      const rows = await apiGet<ChildRow[]>(
        buildResourceUrl("Material Request Item"),
        withSilent(
          buildListConfig({
            fields: [...MR_ITEM_LIST_FIELDS],
            filters: [
              ["parent", "=", mrName],
              ["item_code", "=", itemCode],
            ],
            limit_page_length: 1,
          }),
        ),
      );
      const row = rows?.[0];
      if (row?.name) {
        const docs = await docsFromMrItemChild(row.name);
        if (docs.attachments.length > 0 || docs.part_name) return docs;
      }

      // Purchase MR shortfall rows often lack engineering fields — recover
      // URL refs from the Department source MR (same File, no re-upload).
      const fromSource = await docsFromSourceDepartmentMr(
        mrName,
        itemCode,
        row?.description,
      );
      if (fromSource.attachments.length > 0 || fromSource.part_name) {
        return fromSource;
      }
    } catch {
      /* ignore */
    }
  }

  // 7) MR item child resolved empty — try Department source via parent MR.
  if (input.material_request_item?.trim() && itemCode) {
    const mrParent =
      input.material_request?.trim() ||
      (await parentMrOfChild(input.material_request_item.trim()));
    if (mrParent) {
      const fromSource = await docsFromSourceDepartmentMr(mrParent, itemCode);
      if (fromSource.attachments.length > 0 || fromSource.part_name) {
        return fromSource;
      }
    }
  }

  return EMPTY;
}

async function parentMrOfChild(mrItemName: string): Promise<string | undefined> {
  try {
    const child = await apiGet<{ parent?: string }>(
      buildResourceUrl("Material Request Item", mrItemName),
      withSilent({}),
    );
    return child.parent?.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function docsFromSourceDepartmentMr(
  purchaseMrName: string,
  itemCode: string,
  itemDescription?: string | null,
): Promise<EngineeringDocs> {
  try {
    const mr = await apiGet<{
      custom_warehouse_remarks?: string;
      remarks?: string;
      items?: Array<{ description?: string; item_code?: string; name?: string }>;
    }>(buildResourceUrl("Material Request", purchaseMrName), withSilent({}));

    const sourceName = extractSourceDepartmentMrName({
      custom_warehouse_remarks: mr.custom_warehouse_remarks,
      remarks: mr.remarks,
      items: itemDescription
        ? [{ description: itemDescription }, ...(mr.items ?? [])]
        : mr.items,
    });
    if (!sourceName || sourceName === purchaseMrName) return EMPTY;

    const rows = await apiGet<ChildRow[]>(
      buildResourceUrl("Material Request Item"),
      withSilent(
        buildListConfig({
          fields: [...MR_ITEM_LIST_FIELDS],
          filters: [
            ["parent", "=", sourceName],
            ["item_code", "=", itemCode],
          ],
          limit_page_length: 1,
        }),
      ),
    );
    const row = rows?.[0];
    if (!row?.name) return EMPTY;
    return docsFromMrItemChild(row.name);
  } catch {
    return EMPTY;
  }
}

function engineeringLookupKey(
  line: EngineeringDocsLookup,
  idx = 0,
): string {
  if (line.rfq_name?.trim() && line.item_code?.trim()) {
    return `${line.rfq_name.trim()}::${line.item_code.trim()}`;
  }
  if (line.material_request_item?.trim()) {
    return line.material_request_item.trim();
  }
  if (line.purchase_order_item?.trim()) {
    return line.purchase_order_item.trim();
  }
  if (line.purchase_order?.trim() && line.item_code?.trim()) {
    return `${line.purchase_order.trim()}::${line.item_code.trim()}`;
  }
  if (line.material_request?.trim() && line.item_code?.trim()) {
    return `${line.material_request.trim()}::${line.item_code.trim()}`;
  }
  return `row::${line.item_code ?? idx}`;
}

/** Batch-resolve docs for a table of lines (dedupes by lookup key). */
export async function resolveItemEngineeringDocsBatch(
  lines: EngineeringDocsLookup[],
): Promise<Map<string, EngineeringDocs>> {
  const out = new Map<string, EngineeringDocs>();
  const tasks = lines.map(async (line, idx) => {
    const key = engineeringLookupKey(line, idx);
    if (out.has(key)) return;
    const docs = await resolveItemEngineeringDocs(line);
    out.set(key, docs);
    // Also index by item_code for draft merge convenience.
    if (line.item_code?.trim() && !out.has(line.item_code.trim())) {
      out.set(line.item_code.trim(), docs);
    }
  });
  await Promise.all(tasks);
  return out;
}
