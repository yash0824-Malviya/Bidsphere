import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("./erpnext", () => ({
  apiGet: mocks.apiGet,
  buildResourceUrl: (doctype: string, name?: string) =>
    `/api/resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ""}`,
}));

import { resolveItemUomConfiguration } from "./itemUomConfiguration";

const ITEM_LIST = "/api/resource/Item";
const ITEM_DOCUMENT = "/api/resource/Item/item-master-steel-020";
const UOM_DOCUMENT = "/api/resource/UOM/Kg";
const CATEGORY_DOCUMENT = "/api/resource/UOM%20Category/Mass";
const UOM_LIST = "/api/resource/UOM";

const item = {
  name: "item-master-steel-020",
  item_code: "DIR-STE-020",
  item_name: "Cold Rolled Steel 10",
  description: "Cold rolled steel for the requested assembly",
  item_group: "Steel",
  custom_part_name: "Steel plate",
  stock_uom: "Kg",
  uoms: [{ uom: "Kg", conversion_factor: 1 }],
};

let replies: Map<string, unknown>;

beforeEach(() => {
  mocks.apiGet.mockReset();
  replies = new Map<string, unknown>([
    [ITEM_LIST, [{ name: item.name, item_code: item.item_code }]],
    [ITEM_DOCUMENT, item],
    [UOM_DOCUMENT, { name: "Kg", category: "Mass" }],
    // The live category document has no UOM child table.
    [CATEGORY_DOCUMENT, { name: "Mass", category_name: "Mass" }],
    [UOM_LIST, [{ name: "Kg" }, { name: "G" }, { name: "Ton" }]],
  ]);
  mocks.apiGet.mockImplementation(async (url: string) => {
    if (!replies.has(url)) throw new Error(`Unexpected request: ${url}`);
    const reply = replies.get(url);
    if (reply instanceof Error) throw reply;
    return reply;
  });
});

describe("RFQ Item Master UOM configuration", () => {
  it("loads the steel item's Kg UOM using the supported category filter", async () => {
    const result = await resolveItemUomConfiguration(" DIR-STE-020 ");

    expect(result).toEqual({
      item_code: "DIR-STE-020",
      item_name: "Cold Rolled Steel 10",
      description: item.description,
      item_group: "Steel",
      part_name: "Steel plate",
      default_uom: "Kg",
      compatible_uoms: [
        { uom: "Kg", label: "Kg", conversion_factor: 1, is_primary: true },
      ],
    });
    const categoryRequest = mocks.apiGet.mock.calls.find(([url]) => url === UOM_LIST);
    expect(categoryRequest).toBeDefined();
    expect(JSON.parse(categoryRequest![1].params.fields)).toEqual(["name"]);
    expect(JSON.parse(categoryRequest![1].params.filters)).toEqual([
      ["UOM", "category", "=", "Mass"],
    ]);
    for (const [, config] of mocks.apiGet.mock.calls) {
      expect(JSON.stringify(config ?? {})).not.toContain("uom_category");
    }
    expect(mocks.apiGet).toHaveBeenCalledWith(ITEM_DOCUMENT);
  });

  it("preserves item-specific conversion factors when category rows only contain names", async () => {
    replies.set(ITEM_DOCUMENT, {
      ...item,
      uoms: [...item.uoms, { uom: "Ton", conversion_factor: 1000 }],
    });

    const result = await resolveItemUomConfiguration(item.item_code);

    expect(result?.default_uom).toBe("Kg");
    expect(result?.compatible_uoms).toEqual([
      { uom: "Kg", label: "Kg", conversion_factor: 1, is_primary: true },
      { uom: "Ton", label: "Ton (t)", conversion_factor: 1000, is_primary: false },
    ]);
  });

  it("uses configured category conversion rows without requesting the UOM list", async () => {
    replies.set(CATEGORY_DOCUMENT, {
      name: "Mass",
      uoms: [
        { uom: "Kg", conversion_factor: 1 },
        { uom: "G", conversion_factor: 0.001 },
        { uom: "Ton", conversion_factor: 1000 },
      ],
    });

    const result = await resolveItemUomConfiguration(item.item_code);

    expect(result?.compatible_uoms).toEqual([
      { uom: "Kg", label: "Kg", conversion_factor: 1, is_primary: true },
      { uom: "G", label: "G (g)", conversion_factor: 0.001, is_primary: false },
      { uom: "Ton", label: "Ton (t)", conversion_factor: 1000, is_primary: false },
    ]);
    expect(mocks.apiGet.mock.calls.some(([url]) => url === UOM_LIST)).toBe(false);
  });

  it("retains the stock UOM without a category lookup when no category is configured", async () => {
    replies.set(UOM_DOCUMENT, { name: "Kg" });

    const result = await resolveItemUomConfiguration(item.item_code);

    expect(result?.default_uom).toBe("Kg");
    expect(result?.compatible_uoms.map((option) => option.uom)).toEqual(["Kg"]);
    expect(mocks.apiGet.mock.calls.map(([url]) => url)).toEqual([
      ITEM_LIST, ITEM_DOCUMENT, UOM_DOCUMENT,
    ]);
  });

  it("does not invent a default or query UOMs when the stock UOM is missing", async () => {
    replies.set(ITEM_DOCUMENT, { ...item, stock_uom: " " });

    const result = await resolveItemUomConfiguration(item.item_code);

    expect(result).toMatchObject({
      item_code: item.item_code,
      item_name: item.item_name,
      default_uom: "",
      compatible_uoms: [],
    });
    expect(mocks.apiGet.mock.calls.map(([url]) => url)).toEqual([
      ITEM_LIST, ITEM_DOCUMENT,
    ]);
  });

  it("keeps the Item UOM when optional category requests fail", async () => {
    replies.set(CATEGORY_DOCUMENT, new Error("Category document unavailable"));
    replies.set(UOM_LIST, new Error("Category list unavailable"));

    const result = await resolveItemUomConfiguration(item.item_code);

    expect(result?.default_uom).toBe("Kg");
    expect(result?.compatible_uoms.map((option) => option.uom)).toEqual(["Kg"]);
    expect(mocks.apiGet.mock.calls.some(([url]) => url === UOM_LIST)).toBe(true);
  });

  it("keeps the Item UOM if its optional UOM document is unavailable", async () => {
    replies.set(UOM_DOCUMENT, new Error("UOM document unavailable"));

    const result = await resolveItemUomConfiguration(item.item_code);

    expect(result?.default_uom).toBe("Kg");
    expect(result?.compatible_uoms.map((option) => option.uom)).toEqual(["Kg"]);
    expect(mocks.apiGet.mock.calls.some(([url]) => url === UOM_LIST)).toBe(false);
  });

  it("returns null when the Item document cannot be loaded", async () => {
    replies.set(ITEM_DOCUMENT, new Error("Item unavailable"));

    await expect(resolveItemUomConfiguration(item.item_code)).resolves.toBeNull();
    expect(mocks.apiGet.mock.calls.map(([url]) => url)).toEqual([
      ITEM_LIST, ITEM_DOCUMENT,
    ]);
  });
});
