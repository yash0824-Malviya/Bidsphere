import { it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { createEcrSchemaErpClient } from '../scripts/ecr-schema-erp-client.mjs';
import { createClmDependencies } from '../api/clmErp';
import { parseClmData, clmSnapshotHash, rfqClmFinanceApproved, toClmAggregate } from '../api/clmCore';
import { getPurchaseOrderContract } from '../api/clmPurchaseOrderLink';
import { assertClmSupplierPoReady } from '../api/clmSupplierPoWorkflow';
import { readClmPdf } from '../api/clmSignature';
createEcrSchemaErpClient();
it('read-only live supplier sequence and immutable Contract evidence', async () => {
  const mode = process.env.CLM_SUPPLIER_EXPECT || 'initial';
  const deps = createClmDependencies(), name = 'CON-2026-00001', po = 'PUR-ORD-2026-00028';
  const record = await deps.load('Contract', name), data = parseClmData(record.custom_clm_data);
  const principal = { typ: 'supplier' as const, supplier: String(record.custom_supplier), sub: String(record.custom_supplier), iat: 1, exp: Number.MAX_SAFE_INTEGER };
  const summary = await getPurchaseOrderContract(principal, po, deps);
  expect(summary.contract).toMatchObject({ name, value: 4500, currency: 'USD', rfq: 'PUR-RFQ-2026-00104', award: 'LDC2026-00027' });
  expect(data.rfq_workflow?.phase).toBe('completed');
  expect(rfqClmFinanceApproved(record, data)).toBe(true);
  expect(data.locked_hash).toBe(clmSnapshotHash('Contract', record));
  if (mode === 'inspect') {
    const detail = toClmAggregate(principal, 'Contract', record);
    const evidence = { contract: name, purchase_order: po, acceptance: data.supplier_po_acceptance ? { status: data.supplier_po_acceptance.status, version: data.supplier_po_acceptance.version, at: data.supplier_po_acceptance.at } : null, actions: detail.actions, supplier_workflow: summary.contract?.supplier_workflow, signature_workflow: detail.signature_workflow || null, signatures: data.signatures.map(row => ({ party: row.party, version: row.version, at: row.at })) };
    await writeFile('scratch/clm-supplier-next-step-inspected.json', JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
    return;
  }
  const baselinePath = 'scratch/clm-supplier-sequence-before.json';
  if (mode === 'initial') {
    expect(data.supplier_po_acceptance).toBeUndefined();
    expect(data.signatures.filter(row => row.party === 'supplier')).toHaveLength(0);
    expect(summary.contract?.supplier_workflow).toMatchObject({ can_accept_contract: true, can_sign_contract: false, can_accept_po: false });
    await expect(assertClmSupplierPoReady(principal, po, { load: deps.load, verifyPdf: readClmPdf })).rejects.toThrow();
    await writeFile(baselinePath, JSON.stringify(record, null, 2));
  } else {
    const before = JSON.parse(await readFile(baselinePath, 'utf8')), prior = parseClmData(before.custom_clm_data);
    for (const key of ['approvals', 'versions', 'locked_hash', 'locked_file', 'procurement_completion', 'rfq_workflow']) expect(data[key]).toEqual(prior[key]);
    expect(data.signatures[0]).toEqual(prior.signatures[0]);
    expect(data.audit.slice(0, prior.audit.length)).toEqual(prior.audit);
    expect(data.supplier_po_acceptance).toMatchObject({ status: 'Accepted', version: '1.0', contract: name, purchase_order: po, consent: true });
    expect(data.supplier_po_acceptance?.hash).toBe(prior.signatures[0].hash);
    if (mode === 'accepted') {
      expect(summary.contract?.supplier_workflow).toMatchObject({ can_accept_contract: false, can_sign_contract: true, can_accept_po: false, status: 'Pending Supplier Signature', current_stage: 'E-Signature' });
      const detail = toClmAggregate(principal, 'Contract', record);
      expect(detail.actions).toContainEqual(expect.objectContaining({ action: 'sign' }));
      expect(detail.signature_workflow).toMatchObject({ can_sign: true, legal_status: 'Signed', supplier_status: 'Pending' });
      await expect(assertClmSupplierPoReady(principal, po, { load: deps.load, verifyPdf: readClmPdf })).rejects.toThrow();
    } else {
      const signed = data.signatures.find(row => row.party === 'supplier');
      expect(signed).toMatchObject({ version: '1.0', acceptance_id: data.supplier_po_acceptance?.id });
      expect(signed?.signer_email).toMatch(/@/);
      expect(signed?.full_legal_name).toBeTruthy();
      await readClmPdf(record, signed!);
      await expect(assertClmSupplierPoReady(principal, po, { load: deps.load, verifyPdf: readClmPdf })).resolves.toMatchObject({ supplierSignedAt: signed?.at });
      if (mode === 'po_accepted') {
        const shipments = await deps.list('PO Shipment', [['po_name', '=', po]]);
        expect(shipments).toHaveLength(1);
        expect(Number(shipments[0].supplier_accepted)).toBe(1);
        expect(shipments[0].supplier_acceptance_date).toBeTruthy();
        expect(Date.parse(String(shipments[0].supplier_acceptance_date).replace(' ', 'T'))).toBeGreaterThanOrEqual(Date.parse(signed!.at.replace(' ', 'T')));
        expect(summary.contract?.supplier_workflow).toMatchObject({ po_acceptance_status: 'Accepted', can_accept_contract: false, can_sign_contract: false, can_accept_po: false, current_stage: 'Existing PO Processing', next_stage: 'Completed' });
      } else {
        expect(summary.contract?.supplier_workflow).toMatchObject({ signature_status: 'Signed', can_accept_contract: false, can_sign_contract: false, can_accept_po: true, current_stage: 'Purchase Order Acceptance' });
      }
    }
  }
  await readClmPdf(record, data.locked_file as { file_id: string; file_url: string; hash: string });
  await readClmPdf(record, data.signatures[0]);
  const evidence = { mode: 'READ ONLY', expected_stage: mode, at: new Date().toISOString(), contract: name, po, workflow: summary.contract?.supplier_workflow, acceptance: data.supplier_po_acceptance, signatures: data.signatures.map(({ party, at, version, file_id, hash, signer_email }) => ({ party, at, version, file_id, hash, signer_email })), original_pdf_and_legal_signature: 'verified unchanged' };
  await writeFile(`scratch/clm-supplier-sequence-${mode}-verified.json`, JSON.stringify(evidence, null, 2));
}, 120000);
