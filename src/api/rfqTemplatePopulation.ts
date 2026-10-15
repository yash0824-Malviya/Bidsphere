/**
 * Standard RFQ Template population from existing BidSphere ERPNext records.
 *
 * All item codes, descriptions, and UOMs match verified Item Master records.
 * All supplier names match verified active Supplier records.
 * Office Supplies reflects zero current ERP matching records and allows manual configuration.
 */

import type { RFQTemplate } from "../types/erpnext";
import { readLocalTemplates, saveLocalTemplate } from "./rfqTemplateStorage";

export const INITIAL_TEMPLATES_STORAGE_KEY = "bidsphere-rfq-templates-populated-v2";

export interface CategoryDataAvailability {
  category: string;
  hasData: boolean;
  itemCount: number;
  supplierCount: number;
  message?: string;
}

/**
 * Standard templates populated strictly from verified ERP Item Master and active Supplier records.
 */
export const STANDARD_RFQ_TEMPLATES: Array<
  Omit<RFQTemplate, "name" | "creation" | "modified" | "owner"> & { name: string }
> = [
  {
    name: "TPL-RAW-MATERIALS-PROCUREMENT",
    template_name: "Raw Materials Procurement",
    category: "Raw Materials Procurement",
    procurement_type: "Direct",
    rfq_type: "Standard RFQ",
    description:
      "Direct procurement template for raw materials, aluminum sheets, and primary manufacturing feedstocks.",
    status: "Active",
    estimated_value: 15000,
    cost_breakdown_required: true,
    contract_required: true,
    supplier_terms:
      "1. Materials must conform strictly to mill test certificates and dimensional tolerances.\n2. Delivery must include Certificate of Analysis (CoA).\n3. Standard payment terms: Net 45 days upon material receipt and quality verification.",
    items: [
      {
        item_code: "DIR-ALU-001",
        item_name: "Aluminum Sheet 6061-T6 (4x8ft, 1/8in)",
        description: "Aluminum Sheet 6061-T6 (4x8ft, 1/8in)",
        qty: 10,
        uom: "Sheet",
        specification: "Standard mill-finish 6061-T6 temper with inspection report",
      },
      {
        item_code: "DIR-ALU-002",
        item_name: "Aluminum Sheet 5052-H32 (4x8ft, 1/16in)",
        description: "Aluminum Sheet 5052-H32 (4x8ft, 1/16in)",
        qty: 10,
        uom: "Sheet",
        specification: "5052-H32 marine/forming grade sheet",
      },
      {
        item_code: "201",
        item_name: "Bonnet",
        description: "Bonnet",
        qty: 5,
        uom: "Nos",
        specification: "Raw material vehicle body panel",
      },
    ],
    suppliers: [
      {
        supplier: "Atlantic Precision Manufacturing.",
        supplier_name: "Atlantic Precision Manufacturing.",
      },
      {
        supplier: "Blue Ridge Manufacturing Inc",
        supplier_name: "Blue Ridge Manufacturing Inc",
      },
      {
        supplier: "Apex Fasteners Ltd",
        supplier_name: "Apex Fasteners Ltd",
      },
    ],
    required_documents: {
      terms_and_conditions: true,
      warranty_certificate: true,
      insurance_certificate: true,
      nda: false,
      compliance_certificate: true,
    },
    workflow_rules: {
      budget_approval_required: true,
      legal_review_required: true,
      finance_review_required: true,
      management_approval_required: false,
    },
  },
  {
    name: "TPL-SPARE-PARTS-MAINTENANCE",
    template_name: "Spare Parts & Maintenance",
    category: "Spare Parts & Maintenance",
    procurement_type: "Direct",
    rfq_type: "Standard RFQ",
    description:
      "Procurement template for replacement auto parts, brake components, bearings, and mechanical fasteners.",
    status: "Active",
    estimated_value: 8500,
    cost_breakdown_required: true,
    contract_required: false,
    supplier_terms:
      "1. All components must be OEM certified or approved equivalent.\n2. Warranty period of minimum 12 months from delivery.\n3. Defective items subject to immediate replacement under supplier RMA.",
    items: [
      {
        item_code: "AP001",
        item_name: "Brake Disc",
        description: "Brake Disc",
        qty: 20,
        uom: "Nos",
        specification: "Precision ventilated disc rotor",
      },
      {
        item_code: "AP002",
        item_name: "Brake Calliper",
        description: "Brake Calliper",
        qty: 15,
        uom: "Nos",
        specification: "Dual piston brake caliper assembly",
      },
      {
        item_code: "BRK001",
        item_name: "Brake Pad Set - Ceramic",
        description: "Brake Pad Set - Ceramic",
        qty: 30,
        uom: "Set",
        specification: "High performance ceramic friction set",
      },
      {
        item_code: "DIR-BEA-001",
        item_name: "Deep Groove Ball Bearing 6205-2RS",
        description: "Deep Groove Ball Bearing 6205-2RS",
        qty: 50,
        uom: "Unit",
        specification: "Rubber sealed deep groove radial bearing",
      },
      {
        item_code: "DIR-FAS-001",
        item_name: "Hex Head Bolt Grade 8.8 (M10x50mm)",
        description: "Hex Head Bolt Grade 8.8 (M10x50mm)",
        qty: 25,
        uom: "Box",
        specification: "Zinc plated grade 8.8 metric bolt box",
      },
    ],
    suppliers: [
      {
        supplier: "Autodyne Manufacturing Co Inc",
        supplier_name: "Autodyne Manufacturing Co Inc",
      },
      {
        supplier: "Bosch México",
        supplier_name: "Bosch México",
      },
      {
        supplier: "Liberty Components Corporation",
        supplier_name: "Liberty Components Corporation",
      },
      {
        supplier: "Frontier Industrial Solutions Inc.",
        supplier_name: "Frontier Industrial Solutions Inc.",
      },
    ],
    required_documents: {
      terms_and_conditions: true,
      warranty_certificate: true,
      insurance_certificate: false,
      nda: false,
      compliance_certificate: true,
    },
    workflow_rules: {
      budget_approval_required: true,
      legal_review_required: false,
      finance_review_required: true,
      management_approval_required: false,
    },
  },
  {
    name: "TPL-OFFICE-SUPPLIES",
    template_name: "Office Supplies",
    category: "Office Supplies",
    procurement_type: "Indirect",
    rfq_type: "Standard RFQ",
    description:
      "Indirect procurement template for workplace administration supplies. (No matching Item Master records found in ERP. Configure items manually.)",
    status: "Active",
    estimated_value: 2000,
    cost_breakdown_required: false,
    contract_required: false,
    supplier_terms:
      "1. Commercial invoices must reference the Purchase Order number.\n2. Delivery within 5 business days of PO issuance.\n3. Net 30 days payment terms.",
    items: [], // Explicitly empty: no matching Item Master records in ERP; manual entry supported
    suppliers: [
      {
        supplier: "Northstar Procurement Services",
        supplier_name: "Northstar Procurement Services",
      },
      {
        supplier: "Pioneer Equipment Solutions",
        supplier_name: "Pioneer Equipment Solutions",
      },
    ],
    required_documents: {
      terms_and_conditions: true,
      warranty_certificate: false,
      insurance_certificate: false,
      nda: false,
      compliance_certificate: false,
    },
    workflow_rules: {
      budget_approval_required: true,
      legal_review_required: false,
      finance_review_required: false,
      management_approval_required: false,
    },
  },
  {
    name: "TPL-ELECTRICAL-INDUSTRIAL-COMPONENTS",
    template_name: "Electrical & Industrial Components",
    category: "Electrical & Industrial Components",
    procurement_type: "Direct",
    rfq_type: "Standard RFQ",
    description:
      "Procurement template for internal engine assemblies, suspension joints, and electrical components.",
    status: "Active",
    estimated_value: 22000,
    cost_breakdown_required: true,
    contract_required: true,
    supplier_terms:
      "1. Components must meet ISO/TS automotive quality standards.\n2. Full traceability and batch identification required with each shipment.\n3. Contract agreement and compliance verification required prior to PO.",
    items: [
      {
        item_code: "AC001",
        item_name: "Piston",
        description: "Piston",
        qty: 25,
        uom: "Nos",
        specification: "Cast aluminum combustion engine piston",
      },
      {
        item_code: "APSU001",
        item_name: "Ball Joint",
        description: "Ball Joint",
        qty: 40,
        uom: "Nos",
        specification: "Heavy duty front suspension ball joint",
      },
      {
        item_code: "AP006",
        item_name: "Rear Axle",
        description: "Rear Axle",
        qty: 10,
        uom: "Nos",
        specification: "Rear drive axle shaft assembly",
      },
    ],
    suppliers: [
      {
        supplier: "Aptiv",
        supplier_name: "Aptiv",
      },
      {
        supplier: "Titan Industrial Products LLC",
        supplier_name: "Titan Industrial Products LLC",
      },
      {
        supplier: "Bosch México",
        supplier_name: "Bosch México",
      },
    ],
    required_documents: {
      terms_and_conditions: true,
      warranty_certificate: true,
      insurance_certificate: true,
      nda: true,
      compliance_certificate: true,
    },
    workflow_rules: {
      budget_approval_required: true,
      legal_review_required: true,
      finance_review_required: true,
      management_approval_required: true,
    },
  },
  {
    name: "TPL-GENERAL-PROCUREMENT",
    template_name: "General Procurement",
    category: "General Procurement",
    procurement_type: "Indirect",
    rfq_type: "Standard RFQ",
    description:
      "General plant operations procurement covering packaging corrugated materials, industrial fluids, and lubricants.",
    status: "Active",
    estimated_value: 5000,
    cost_breakdown_required: false,
    contract_required: false,
    supplier_terms:
      "1. Packaging materials must be environmentally sustainable and corrugated.\n2. Chemical fluids and lubricants must be accompanied by active Safety Data Sheets (SDS).\n3. Net 30 days upon delivery acceptance.",
    items: [
      {
        item_code: "DIR-COR-001",
        item_name: "Single Wall Corrugated Box (12x12x12 in)",
        description: "Single Wall Corrugated Box (12x12x12 in)",
        qty: 100,
        uom: "Box",
        specification: "32 ECT single-wall corrugated carton",
      },
      {
        item_code: "CF001",
        item_name: "Brake Fluid DOT 4",
        description: "Brake Fluid DOT 4",
        qty: 50,
        uom: "Liter",
        specification: "High boiling point DOT 4 brake hydraulic fluid",
      },
      {
        item_code: "CL001",
        item_name: "Engine Oil 5W-30 Synthetic",
        description: "Engine Oil 5W-30 Synthetic",
        qty: 40,
        uom: "Liter",
        specification: "Full synthetic motor oil 5W-30 API SN",
      },
      {
        item_code: "AB001",
        item_name: "Bumper",
        description: "Bumper",
        qty: 10,
        uom: "Nos",
        specification: "Commercial vehicle protective bumper assembly",
      },
    ],
    suppliers: [
      {
        supplier: "Summit Industrial Supply LLC",
        supplier_name: "Summit Industrial Supply LLC",
      },
      {
        supplier: "Midwest Materials & Equipment Co.",
        supplier_name: "Midwest Materials & Equipment Co.",
      },
      {
        supplier: "Redwood Supply Chain Partners",
        supplier_name: "Redwood Supply Chain Partners",
      },
    ],
    required_documents: {
      terms_and_conditions: true,
      warranty_certificate: false,
      insurance_certificate: false,
      nda: false,
      compliance_certificate: true,
    },
    workflow_rules: {
      budget_approval_required: true,
      legal_review_required: false,
      finance_review_required: true,
      management_approval_required: false,
    },
  },
];

/**
 * Assess availability of Item Master data per template category.
 */
export function getCategoryAvailability(template: RFQTemplate): CategoryDataAvailability {
  const itemCount = template.items?.length ?? 0;
  const supplierCount = template.suppliers?.length ?? 0;
  const hasData = itemCount > 0;

  return {
    category: template.category,
    hasData,
    itemCount,
    supplierCount,
    message: hasData
      ? undefined
      : "No matching Item Master records found in ERP. Configure items manually.",
  };
}

/**
 * Seed standard templates once into the persistent local store.
 * Strictly prevents duplicate entries on repeated executions.
 */
export function ensureStandardTemplatesPopulated(): RFQTemplate[] {
  try {
    const isPopulated = localStorage.getItem(INITIAL_TEMPLATES_STORAGE_KEY);
    const existing = readLocalTemplates();

    if (isPopulated && existing.length > 0) {
      return existing;
    }

    const now = new Date().toISOString();
    const existingMap = new Map(existing.map((t) => [t.name, t]));

    for (const standard of STANDARD_RFQ_TEMPLATES) {
      if (!existingMap.has(standard.name)) {
        const tpl: RFQTemplate = {
          ...standard,
          usage_count: 0,
          creation: now,
          modified: now,
          owner: "Administrator",
        };
        saveLocalTemplate(tpl);
      }
    }

    localStorage.setItem(INITIAL_TEMPLATES_STORAGE_KEY, "true");
    return readLocalTemplates();
  } catch {
    return readLocalTemplates();
  }
}
