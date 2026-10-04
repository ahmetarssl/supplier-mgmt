import cds from '@sap/cds'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { analyzeCertificate, extractPdfText, AIError } from './lib/ai-analyzer.js'

const LOG = cds.log('supplier')

const MAX_CERTIFICATE_BYTES = 10 * 1024 * 1024 // 10 MB
const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours
const BCRYPT_ROUNDS = 10
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const URL_RE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i
const PASSWORD_RULES = [/^.{8,}$/, /[A-Z]/, /[a-z]/, /\d/, /[^A-Za-z0-9]/]
const CATEGORIES = ['HARDWARE', 'SOFTWARE', 'SERVICES', 'CONSULTING']
const FORM_FIELDS = ['companyName', 'contactPerson', 'phone', 'country', 'category', 'taxNumber', 'website', 'address', 'notes']
const REVISABLE_FIELDS = [...FORM_FIELDS, 'certificate']
const OPEN_STATUSES = ['SUBMITTED', 'IN_REVIEW']

const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', BCRYPT_ROUNDS)

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex')
const normalizeEmail = email => String(email ?? '').trim().toLowerCase()
const clean = value => {
  if (value === undefined || value === null) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}
const revisionList = row => (row?.revisionFields ? row.revisionFields.split(',').filter(Boolean) : [])

async function streamToBuffer(stream, limit) {
  if (stream === null || stream === undefined) return null
  if (Buffer.isBuffer(stream)) return stream
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (limit && size > limit) {
      stream.destroy?.()
      return { tooLarge: true }
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export default class SupplierService extends cds.ApplicationService {
  async init() {
    const db = cds.entities('supplier.mgmt')
    const { CertificateUploads, Suppliers } = this.entities

  

    const createSession = async accountId => {
      const token = crypto.randomBytes(32).toString('hex')
      await DELETE.from(db.SupplierSessions).where({ account_ID: accountId, expiresAt: { '<': new Date().toISOString() } })
      await INSERT.into(db.SupplierSessions).entries({
        tokenHash: sha256(token),
        account_ID: accountId,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
      })
      return token
    }


    const requireAccount = async req => {
      const token = req.headers?.['x-supplier-token']
      if (!token) return req.reject(403, 'SESSION_REQUIRED')
      const session = await SELECT.one.from(db.SupplierSessions).where({ tokenHash: sha256(token) })
      if (!session || new Date(session.expiresAt) < new Date()) return req.reject(403, 'SESSION_EXPIRED')
      return session.account_ID
    }

    const findApplication = accountId => SELECT.one.from(db.Suppliers).where({ account_ID: accountId })

    const toInfo = row =>
      row && {
        ID: row.ID,
        email: row.email,
        companyName: row.companyName,
        contactPerson: row.contactPerson,
        phone: row.phone,
        country: row.country,
        category: row.category,
        taxNumber: row.taxNumber,
        website: row.website,
        address: row.address,
        notes: row.notes,
        status: row.status,
        submittedAt: row.submittedAt,
        decidedAt: row.decidedAt,
        rejectionComment: row.rejectionComment,
        revisionFields: row.revisionFields,
        certificateFileName: row.certificateFileName,
        certificateSize: row.certificateSize
      }

    
    const validateForm = (req, data) => {
      if (!data.companyName) req.error(400, 'COMPANY_NAME_REQUIRED', [], 'companyName')
      if (!data.contactPerson) req.error(400, 'CONTACT_PERSON_REQUIRED', [], 'contactPerson')
      if (data.category && !CATEGORIES.includes(data.category)) req.error(400, 'CATEGORY_INVALID', [], 'category')
      if (data.website && !URL_RE.test(data.website)) req.error(400, 'WEBSITE_INVALID', [], 'website')
      for (const field of FORM_FIELDS) {
        const max = db.Suppliers.elements[field].length
        if (max && data[field] && data[field].length > max) req.error(400, 'FIELD_TOO_LONG', [field, max], field)
      }
      if (req.errors) throw req.reject()
    }



    this.on('register', async req => {
      const email = normalizeEmail(req.data.email)
      const password = String(req.data.password ?? '')
      if (!EMAIL_RE.test(email) || email.length > 255) return req.reject(400, 'EMAIL_INVALID', [], 'email')
      if (!PASSWORD_RULES.every(rule => rule.test(password)) || password.length > 72)
        return req.reject(400, 'PASSWORD_WEAK', [], 'password')

      const exists = await SELECT.one.from(db.SupplierAccounts).columns('ID').where({ email })
      if (exists) return req.reject(409, 'EMAIL_ALREADY_EXISTS', [], 'email')

      const ID = cds.utils.uuid()
      try {
        await INSERT.into(db.SupplierAccounts).entries({ ID, email, passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) })
      } catch (e) {
       
        if (/unique/i.test(e.message)) return req.reject(409, 'EMAIL_ALREADY_EXISTS', [], 'email')
        throw e
      }
      LOG.info('supplier registered', email)
      
      return { token: await createSession(ID), email }
    })

    this.on('login', async req => {
      const email = normalizeEmail(req.data.email)
      const password = String(req.data.password ?? '')
      const account = await SELECT.one.from(db.SupplierAccounts).where({ email })
      const ok = await bcrypt.compare(password, account?.passwordHash ?? DUMMY_HASH)
      if (!account || !ok) return req.reject(400, 'INVALID_CREDENTIALS')
      return { token: await createSession(account.ID), email }
    })

    this.on('logout', async req => {
      const token = req.headers?.['x-supplier-token']
      if (token) await DELETE.from(db.SupplierSessions).where({ tokenHash: sha256(token) })
    })


    this.on('getMyApplication', async req => {
      const accountId = await requireAccount(req)
      return toInfo(await findApplication(accountId)) ?? null
    })

    this.on('saveApplication', async req => {
      const accountId = await requireAccount(req)
      const data = Object.fromEntries(FORM_FIELDS.map(f => [f, clean(req.data[f])]))
      validateForm(req, data)

      const existing = await findApplication(accountId)
      if (!existing) {
        const account = await SELECT.one.from(db.SupplierAccounts).columns('email').where({ ID: accountId })
        const ID = cds.utils.uuid()
        await INSERT.into(db.Suppliers).entries({ ID, account_ID: accountId, email: account.email, status: 'DRAFT', ...data })
        return toInfo(await SELECT.one.from(db.Suppliers, ID))
      }

      if (existing.status === 'REJECTED') {
        const allowed = revisionList(existing)
        for (const field of FORM_FIELDS) {
          if (!allowed.includes(field) && (existing[field] ?? null) !== data[field])
            req.error(403, 'FIELD_NOT_REVISABLE', [field], field)
        }
        if (req.errors) throw req.reject()
      } else if (existing.status !== 'DRAFT') {
        return req.reject(409, 'APPLICATION_LOCKED')
      }

      await UPDATE(db.Suppliers, existing.ID).with(data)
      return toInfo(await SELECT.one.from(db.Suppliers, existing.ID))
    })

    this.before('UPDATE', CertificateUploads, async req => {
      const accountId = await requireAccount(req)
      const ID = req.data.ID ?? req.params?.at(-1)?.ID ?? req.params?.at(-1)
      const application = await SELECT.one.from(db.Suppliers).where({ ID, account_ID: accountId })
      if (!application) return req.reject(404, 'APPLICATION_NOT_FOUND')
      if (application.status === 'REJECTED') {
        if (!revisionList(application).includes('certificate')) return req.reject(403, 'CERTIFICATE_NOT_REVISABLE')
      } else if (application.status !== 'DRAFT') {
        return req.reject(409, 'APPLICATION_LOCKED')
      }
      if (!('certificate' in req.data)) return req.reject(400, 'CERTIFICATE_REQUIRED')

   
      const contentType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      if (contentType !== 'application/pdf') return req.reject(415, 'CERTIFICATE_NOT_PDF')
      const declaredSize = Number(req.headers['content-length'])
      if (declaredSize > MAX_CERTIFICATE_BYTES) return req.reject(413, 'CERTIFICATE_TOO_LARGE')

      
      const buffer = await streamToBuffer(req.data.certificate, MAX_CERTIFICATE_BYTES)
      if (!buffer || buffer.length === 0) return req.reject(400, 'CERTIFICATE_REQUIRED')
      if (buffer.tooLarge) return req.reject(413, 'CERTIFICATE_TOO_LARGE')

     
      if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return req.reject(415, 'CERTIFICATE_NOT_PDF')

      let fileName = 'certificate.pdf'
      try {
        if (req.headers.slug) fileName = decodeURIComponent(req.headers.slug).slice(0, 255)
      } catch {
       
      }

      req.data.certificate = buffer
      req.data.certificateMediaType = 'application/pdf'
      req.data.certificateFileName = fileName
      
      req._certificateMeta = { certificateSize: buffer.length, certificateUploadedAt: new Date().toISOString() }
    })

    this.after('UPDATE', CertificateUploads, async (_, req) => {
      const ID = req.data.ID ?? req.params?.at(-1)?.ID ?? req.params?.at(-1)
      if (req._certificateMeta) await UPDATE(db.Suppliers, ID).with(req._certificateMeta)
    })

    this.on('submitApplication', async req => {
      const accountId = await requireAccount(req)
      const application = await findApplication(accountId)
      if (!application) return req.reject(404, 'APPLICATION_NOT_FOUND')
      if (!['DRAFT', 'REJECTED'].includes(application.status)) return req.reject(409, 'APPLICATION_LOCKED')

      
      if (!application.companyName) req.error(400, 'COMPANY_NAME_REQUIRED', [], 'companyName')
      if (!application.contactPerson) req.error(400, 'CONTACT_PERSON_REQUIRED', [], 'contactPerson')
      if (!application.certificateSize) req.error(400, 'CERTIFICATE_REQUIRED', [], 'certificate')
      else if (
        application.status === 'REJECTED' &&
        revisionList(application).includes('certificate') &&
        !(new Date(application.certificateUploadedAt) > new Date(application.decidedAt))
      )
        req.error(400, 'CERTIFICATE_NEW_REQUIRED', [], 'certificate')
      if (req.errors) throw req.reject()

      await UPDATE(db.Suppliers, application.ID).with({
        status: 'SUBMITTED',
        submittedAt: new Date().toISOString(),
        submissionCount: (application.submissionCount ?? 0) + 1,
        decidedAt: null,
        decidedBy: null,
        decisionSource: null,
        rejectionComment: null,
        revisionFields: null
      })
      LOG.info('application submitted', application.ID)
      return toInfo(await SELECT.one.from(db.Suppliers, application.ID))
    })


    const keyOf = req => {
      const key = req.params?.at(-1)
      return key?.ID ?? key
    }

  
    const decide = async (req, ID, changes) => {
      const affected = await UPDATE(db.Suppliers, ID)
        .with({ ...changes, decidedAt: new Date().toISOString(), decidedBy: req.user.id })
        .where({ status: { in: OPEN_STATUSES } })
      if (!affected) return req.reject(409, 'ALREADY_DECIDED')
    }

    this.on('startReview', Suppliers, async req => {
      await UPDATE(db.Suppliers, keyOf(req)).with({ status: 'IN_REVIEW' }).where({ status: 'SUBMITTED' })
    })

    this.on('approveApplication', Suppliers, async req => {
      await decide(req, keyOf(req), { status: 'APPROVED', decisionSource: 'MANUAL' })
    })

    this.on('rejectApplication', Suppliers, async req => {
      const comment = clean(req.data.comment)
      if (!comment) return req.reject(400, 'REJECTION_COMMENT_REQUIRED', [], 'comment')
      if (comment.length > 1000) return req.reject(400, 'FIELD_TOO_LONG', ['comment', 1000], 'comment')
      let fields = String(req.data.revisionFields ?? '')
        .split(',')
        .map(f => f.trim())
        .filter(Boolean)
      if (fields.some(f => !REVISABLE_FIELDS.includes(f))) return req.reject(400, 'REVISION_FIELDS_INVALID')
      if (!fields.length) fields = ['certificate'] // at least a new certificate can always be uploaded
      await decide(req, keyOf(req), {
        status: 'REJECTED',
        decisionSource: 'MANUAL',
        rejectionComment: comment,
        revisionFields: [...new Set(fields)].join(',')
      })
    })

    this.on('analyzeWithAI', Suppliers, async req => {
      const ID = keyOf(req)
      const application = await SELECT.one.from(db.Suppliers, ID)
      if (!application) return req.reject(404, 'APPLICATION_NOT_FOUND')
      if (!OPEN_STATUSES.includes(application.status)) return req.reject(409, 'ALREADY_DECIDED')

      const { certificate } = await SELECT.one.from(db.Suppliers, ID).columns('certificate')
      const pdf = await streamToBuffer(certificate)
      if (!pdf) return req.reject(400, 'CERTIFICATE_REQUIRED')

      let result
      try {
        const pdfText = await extractPdfText(pdf)
        result = await analyzeCertificate({ supplier: application, pdfText, locale: req.locale })
      } catch (e) {
        if (e instanceof AIError && e.code === 'AI_NO_TEXT') return req.reject(422, 'AI_NO_TEXT')
        LOG.error('AI analysis failed', e.message)
        return req.reject(502, 'AI_UNAVAILABLE')
      }

      const status = result.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'
      await decide(req, ID, {
        status,
        decisionSource: 'AI',
    
        rejectionComment: status === 'REJECTED' ? result.reason : null,
        revisionFields: status === 'REJECTED' ? 'certificate' : null
      })
      return { decision: result.decision, reason: result.reason, status }
    })

    this.on('getStatusCounts', async () => {
      const rows = await SELECT.from(db.Suppliers)
        .columns('status', 'count(*) as count')
        .where({ status: { '!=': 'DRAFT' } })
        .groupBy('status')
      const count = status => rows.find(r => r.status === status)?.count ?? 0
      return {
        total: rows.reduce((sum, r) => sum + r.count, 0),
        pending: count('SUBMITTED') + count('IN_REVIEW'),
        approved: count('APPROVED'),
        rejected: count('REJECTED')
      }
    })

    return super.init()
  }
}
