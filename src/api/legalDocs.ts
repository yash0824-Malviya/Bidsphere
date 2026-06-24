export interface LegalDocumentSet {
  sq_name: string
  rfq_name?: string
  supplier: string
  terms_pdf_key?: string      // IndexedDB key, NOT base64
  terms_pdf_name?: string
  terms_note?: string
  terms_viewed?: boolean
  terms_approved?: boolean
  warranty_pdf_key?: string
  warranty_pdf_name?: string
  warranty_note?: string
  warranty_viewed?: boolean
  warranty_approved?: boolean
  insurance_pdf_key?: string
  insurance_pdf_name?: string
  insurance_note?: string
  insurance_viewed?: boolean
  insurance_approved?: boolean
  submitted_by_supplier_at?: string
  review_status: 'pending' | 'approved' | 'rejected' | 'not_submitted'
  reviewed_by?: string
  reviewed_at?: string
  review_note?: string
}

export type LegalDocFlagField =
  | 'terms_viewed'
  | 'terms_approved'
  | 'warranty_viewed'
  | 'warranty_approved'
  | 'insurance_viewed'
  | 'insurance_approved'

const KEY_PREFIX = 'legal_docs_'

export const getLegalDocs = (sqName: string): LegalDocumentSet | null => {
  if (!sqName) return null
  const data = localStorage.getItem(`${KEY_PREFIX}${sqName}`)
  return data ? JSON.parse(data) : null
}

export const saveLegalDocs = (docs: LegalDocumentSet): void => {
  // eslint-disable-next-line no-console
  console.log('[legalDocs.ts] saveLegalDocs called with sq_name:', docs.sq_name)
  try {
    const key = `${KEY_PREFIX}${docs.sq_name}`
    // eslint-disable-next-line no-console
    console.log('[legalDocs.ts] Writing to key:', key)
    localStorage.setItem(key, JSON.stringify(docs))
    // eslint-disable-next-line no-console
    console.log('[legalDocs.ts] Write succeeded, verifying:', localStorage.getItem(key) ? 'EXISTS' : 'MISSING')

    const indexKey = 'legal_docs_index'
    const index: string[] = JSON.parse(localStorage.getItem(indexKey) || '[]')
    // eslint-disable-next-line no-console
    console.log('[legalDocs.ts] Current index before update:', index)
    if (!index.includes(docs.sq_name)) {
      index.push(docs.sq_name)
      localStorage.setItem(indexKey, JSON.stringify(index))
      // eslint-disable-next-line no-console
      console.log('[legalDocs.ts] Index updated to:', index)
    }
  } catch (err: any) {
    console.error('[legalDocs.ts] SAVE FAILED:', err.message)
    throw new Error('Could not save document metadata. Storage quota exceeded.')
  }
}

export const getAllLegalDocs = (): LegalDocumentSet[] => {
  const index: string[] = JSON.parse(localStorage.getItem('legal_docs_index') || '[]')
  return index.map(key => getLegalDocs(key)).filter(Boolean) as LegalDocumentSet[]
}

export const getOrCreateLegalDocs = (sqName: string, supplier: string): LegalDocumentSet => {
  const existing = getLegalDocs(sqName)
  if (existing) return existing
  const fresh: LegalDocumentSet = {
    sq_name: sqName,
    supplier,
    review_status: 'pending'
  }
  saveLegalDocs(fresh)
  return fresh
}

export const updateLegalDocField = (
  sqName: string,
  field: keyof LegalDocumentSet,
  value: any
): LegalDocumentSet => {
  const docs = getLegalDocs(sqName) || { sq_name: sqName, supplier: '', review_status: 'pending' as const }
  const updated = { ...docs, [field]: value }
  saveLegalDocs(updated)
  return updated
}

export const updateLegalDocFlag = (
  sqName: string,
  field: LegalDocFlagField,
  value: boolean
): LegalDocumentSet | null => {
  const docs = getLegalDocs(sqName)
  if (!docs) return null
  const updated = { ...docs, [field]: value }
  saveLegalDocs(updated)
  return updated
}

export const submitLegalReview = (
  sqName: string,
  status: 'approved' | 'rejected',
  reviewedBy: string,
  note: string
): LegalDocumentSet => {
  const docs = getLegalDocs(sqName)
  if (!docs) throw new Error('No documents found for this RFQ/Supplier')
  const updated: LegalDocumentSet = {
    ...docs,
    review_status: status,
    reviewed_by: reviewedBy,
    reviewed_at: new Date().toISOString(),
    review_note: note
  }
  saveLegalDocs(updated)
  return updated
}

export const cleanupOversizedLegalDocs = () => {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('legal_docs_') && k !== 'legal_docs_index')
  keys.forEach(key => {
    const value = localStorage.getItem(key) || ''
    if (value.length > 50000) { // anything over ~50KB of JSON text is suspect
      console.warn('[Cleanup] Removing oversized legal doc entry:', key, `(${(value.length/1024).toFixed(0)}KB)`)
      localStorage.removeItem(key)
    }
  })
}
