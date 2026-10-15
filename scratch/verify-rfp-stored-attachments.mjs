import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { createEcrSchemaErpClient, ecrSchemaResource } from '../scripts/ecr-schema-erp-client.mjs';

// Read-only storage validation with the configured ERP service account.
// This does not create a user session or call authenticated BidSphere routes.
const api = createEcrSchemaErpClient();
const server = await createServer({ configFile: false, cacheDir: 'scratch/rfp-readonly-vite-cache', server: { middlewareMode: true, watch: null }, appType: 'custom' });
try {
  const { canonicalErpFilePath, fetchErpFile } = await server.ssrLoadModule('/api/fileProxyCore.ts');
  const response = await api('GET', ecrSchemaResource('RFP Response', 'th43q445al'));
  assert.equal(response.rfp, 'RFP-2026-00001');
  const documents = JSON.parse(response.documents_json);
  assert.equal(documents.length, 7);
  const baseUrl = (process.env.ERPNEXT_URL ?? process.env.VITE_PROXY_TARGET ?? process.env.VITE_ERPNEXT_URL).replace(/\/+$/, '').replace(/\/api$/, '');
  const key = process.env.ERP_API_KEY ?? process.env.VITE_API_KEY;
  const secret = process.env.ERP_API_SECRET ?? process.env.VITE_API_SECRET;
  const failures = [];
  for (const document of documents) {
    const selected = await api('GET', ecrSchemaResource('File', document.file.file_id));
    assert.equal(selected.name, document.file.file_id);
    assert.equal(selected.attached_to_doctype, 'RFP Response');
    assert.equal(selected.attached_to_name, response.name);
    assert.equal(canonicalErpFilePath(selected.file_url), canonicalErpFilePath(document.file.file_url));
    assert.equal(selected.is_private, 1);
    const result = await fetchErpFile({ baseUrl, filePath: document.file.file_url, fileId: selected.name,
      apiKey: key, apiSecret: secret,
      authorizeFile: async (file) => { assert.equal(file.name, selected.name); assert.equal(file.attached_to_name, response.name); },
    });
    if (!result.ok) {
      const storedBytes = await fetch(new URL(selected.file_url.split('/').map(encodeURIComponent).join('/'), baseUrl), { headers: { Authorization: `token ${key}:${secret}` } });
      const buffer = Buffer.from(await storedBytes.arrayBuffer());
      const htmlStored = /^\s*<!doctype html|^\s*<html/i.test(buffer.subarray(0, 60).toString('utf8'));
      const failure = { document: document.doc_type, fileId: selected.name, status: result.status, private: true, parentVerified: true, storedBytes: buffer.length, fileRecordSize: selected.file_size, htmlStored, persistedContentHashMatches: createHash('md5').update(buffer).digest('hex') === selected.content_hash };
      failures.push(failure);
      console.log(JSON.stringify(failure));
      continue;
    }
    console.log(JSON.stringify({ document: document.doc_type, fileId: selected.name, status: result.status, contentType: result.contentType, bytes: result.buffer.length, private: true, parentVerified: true }));
  }
  console.log(JSON.stringify({ verifiedParents: documents.length, readableFiles: documents.length - failures.length, failures, writes: 0 }));
} finally { await server.close(); }
