export interface ECREngineeringNoteSections {
  engineeringNotes: string;
  costImpact: string;
  customerImpact: string;
  contractImpact: string;
  technicalRequirements: string;
  commercialRequirements: string;
  deliveryRequirements: string;
  qualityRequirements: string;
  supplierImpact: string;
}

type StructuredSection = Exclude<keyof ECREngineeringNoteSections, "engineeringNotes">;

const SECTION_LABELS: Array<[StructuredSection, string]> = [
  ["costImpact", "Cost Impact"],
  ["customerImpact", "Customer Impact"],
  ["contractImpact", "Contract Impact"],
  ["technicalRequirements", "Technical Requirements"],
  ["commercialRequirements", "Commercial Requirements"],
  ["deliveryRequirements", "Delivery Requirements"],
  ["qualityRequirements", "Quality Requirements"],
  ["supplierImpact", "Supplier Impact"],
];

const SECTION_BY_LABEL = new Map(
  SECTION_LABELS.map(([key, label]) => [label.toLowerCase(), key]),
);

function emptySections(): ECREngineeringNoteSections {
  return {
    engineeringNotes: "",
    costImpact: "",
    customerImpact: "",
    contractImpact: "",
    technicalRequirements: "",
    commercialRequirements: "",
    deliveryRequirements: "",
    qualityRequirements: "",
    supplierImpact: "",
  };
}

/**
 * Decode the legacy, label-based representation stored in `engineering_notes`.
 * Continuation lines remain attached to the last recognized label so multiline
 * requirements survive an edit/resave cycle.
 */
export function parseECREngineeringNotes(value?: string | null): ECREngineeringNoteSections {
  const result = emptySections();
  let activeSection: keyof ECREngineeringNoteSections = "engineeringNotes";

  for (const line of String(value ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const marker = line.match(/^([^:\n]+):\s*(.*)$/);
    const structuredKey = marker
      ? SECTION_BY_LABEL.get(marker[1].trim().toLowerCase())
      : undefined;

    if (structuredKey) {
      activeSection = structuredKey;
      result[structuredKey] = marker?.[2] ?? "";
      continue;
    }

    result[activeSection] = result[activeSection]
      ? `${result[activeSection]}\n${line}`
      : line;
  }

  for (const key of Object.keys(result) as Array<keyof ECREngineeringNoteSections>) {
    result[key] = result[key].trim();
  }
  return result;
}

/** Encode the editable note sections once, without retaining stale labels. */
export function serializeECREngineeringNotes(
  sections: Partial<ECREngineeringNoteSections>,
): string {
  const blocks: string[] = [];
  const base = sections.engineeringNotes?.trim();
  if (base) blocks.push(base);

  for (const [key, label] of SECTION_LABELS) {
    const value = sections[key]?.trim();
    if (value) blocks.push(`${label}: ${value}`);
  }
  return blocks.join("\n\n");
}
