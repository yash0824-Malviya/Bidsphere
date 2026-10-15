import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEcrSchemaErpClient, ecrSchemaResource } from "../scripts/ecr-schema-erp-client.mjs";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}

const api = createEcrSchemaErpClient();
const contract = await api("GET", ecrSchemaResource("Contract", "CON-2026-00004"));
console.log("ALL KEYS IN CON-2026-00004:", Object.keys(contract));
console.log("DATES & STATUS IN CON-2026-00004:", {
  start_date: contract.start_date,
  end_date: contract.end_date,
  contract_start_date: contract.contract_start_date,
  contract_end_date: contract.contract_end_date,
  custom_contract_start_date: contract.custom_contract_start_date,
  custom_contract_end_date: contract.custom_contract_end_date,
  status: contract.status,
  custom_contract_status: contract.custom_contract_status,
  custom_rfq: contract.custom_rfq,
  custom_clm_data: typeof contract.custom_clm_data === "string" ? JSON.parse(contract.custom_clm_data) : contract.custom_clm_data,
});
