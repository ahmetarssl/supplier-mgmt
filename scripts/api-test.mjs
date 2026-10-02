/* eslint-disable no-console */
/**
 * Backend smoke test: runs the success AND failure scenarios of the case against CAP directly.
 *
 *   npm run watch          (terminal 1, development profile with mocked users)
 *   npm run test:api       (terminal 2)
 *
 * Approver calls use the mocked users from package.json (approver/approver, norole/norole).
 * The AI scenario needs a reachable 'openrouter-api' destination; it is skipped otherwise.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE_URL ?? 'http://localhost:4004/odata/v4/supplier'
const FILES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'files')
const LANG = process.env.LANG_HEADER ?? 'tr'
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64')
const APPROVER = basic('approver', 'approver')
const NOROLE = basic('norole', 'norole')

let failures = 0
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '  ✔' : '  ✘'} ${name}${condition ? '' : '  -> ' + detail}`)
  if (!condition) failures++
}

async function call(name, { method = 'POST', body, token, auth, headers = {} } = {}) {
  const res = await fetch(`${BASE}/${name}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': LANG,
      ...(token && { 'X-Supplier-Token': token }),
      ...(auth && { Authorization: auth }),
      ...headers
    },
    body: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = text
  }
  return { status: res.status, json, message: json?.error?.message }
}

const upload = (id, file, token, contentType = 'application/pdf') =>
  call(`CertificateUploads(${id})/certificate`, {
    method: 'PUT',
    token,
    body: fs.readFileSync(path.join(FILES, file)),
    headers: { 'Content-Type': contentType, slug: encodeURIComponent(file) }
  })

const unique = Date.now()
const email = `supplier${unique}@test.com`
const password = 'Str0ng!Pass'

console.log('\nRegister / login')
check('weak password rejected (400)', (await call('register', { body: { email, password: 'weak' } })).status === 400)
const reg = await call('register', { body: { email, password } })
check('register ok + auto login token', reg.status === 200 && reg.json.token, JSON.stringify(reg.json))
const token = reg.json.token
const dup = await call('register', { body: { email: email.toUpperCase(), password } })
check('same e-mail again -> 409', dup.status === 409, JSON.stringify(dup.json))
console.log('     message:', dup.message)
const badLogin = await call('login', { body: { email, password: 'Wrong!Pass1' } })
check('wrong password -> 400', badLogin.status === 400)
const unknownLogin = await call('login', { body: { email: 'nobody@test.com', password } })
check('unknown e-mail -> same message', unknownLogin.status === 400 && unknownLogin.message === badLogin.message)
console.log('     message:', badLogin.message)
check('login ok', (await call('login', { body: { email, password } })).json?.token?.length === 64)
check('no token -> 403', (await call('getMyApplication()', { method: 'GET' })).status === 403)

console.log('\nApplication form')
const empty = await call('saveApplication', { token, body: { companyName: '', contactPerson: ' ' } })
check('empty required fields -> 400', empty.status === 400, JSON.stringify(empty.json))
console.log('     message:', empty.message, (empty.json?.error?.details ?? []).map(d => d.message).join(' | '))
const form = {
  companyName: 'Anadolu Elektronik A.S.',
  contactPerson: 'Ayse Yilmaz',
  phone: '+90 312 555 00 00',
  country: 'Turkey',
  category: 'HARDWARE',
  taxNumber: '0681234567',
  website: 'https://anadolu-elektronik.example',
  address: 'OSB 3. Cadde No:12, Ankara',
  notes: 'Sensors and PCBs'
}
const saved = await call('saveApplication', { token, body: form })
check('save draft ok', saved.status === 200 && saved.json.status === 'DRAFT', JSON.stringify(saved.json))
const id = saved.json.ID
const noCert = await call('submitApplication', { token, body: {} })
check('submit without certificate -> 400', noCert.status === 400, JSON.stringify(noCert.json))
console.log('     message:', noCert.message)

console.log('\nCertificate upload')
const big = await upload(id, 'too-large-11mb.pdf', token)
check('> 10 MB -> 413', big.status === 413, JSON.stringify(big.json))
console.log('     message:', big.message)
const txt = await upload(id, 'not-a-pdf.txt', token, 'text/plain')
check('text/plain -> 415', txt.status === 415, JSON.stringify(txt.json))
console.log('     message:', txt.message)
const renamed = await upload(id, 'renamed-image.pdf', token)
check('PNG renamed to .pdf -> 415 (magic bytes)', renamed.status === 415, JSON.stringify(renamed.json))
const otherToken = (await call('register', { body: { email: `other${unique}@test.com`, password } })).json.token
check('upload to foreign application -> 404', (await upload(id, 'valid-certificate.pdf', otherToken)).status === 404)
const ok = await upload(id, 'valid-certificate.pdf', token)
check('valid pdf upload -> 204', ok.status === 204, JSON.stringify(ok.json))

console.log('\nApprover access')
check('anonymous cannot list Suppliers', [401, 403].includes((await call('Suppliers', { method: 'GET' })).status))
check('user without role -> 403', (await call('Suppliers', { method: 'GET', auth: NOROLE })).status === 403)
const draftsHidden = await call(`Suppliers(${id})`, { method: 'GET', auth: APPROVER })
check('drafts are invisible to approvers', draftsHidden.status === 404)

const sub = await call('submitApplication', { token, body: {} })
check('submit ok', sub.status === 200 && sub.json.status === 'SUBMITTED', JSON.stringify(sub.json))
check('form locked after submit -> 409', (await call('saveApplication', { token, body: form })).status === 409)
check('certificate locked after submit -> 409', (await upload(id, 'valid-certificate.pdf', token)).status === 409)

const list = await call(`Suppliers?$filter=status eq 'SUBMITTED'&$select=ID,companyName,status`, { method: 'GET', auth: APPROVER })
check('approver sees submitted application', list.json?.value?.some(s => s.ID === id), JSON.stringify(list.json))
const cert = await fetch(`${BASE}/Suppliers(${id})/certificate`, { headers: { Authorization: APPROVER } })
check('approver can download certificate', cert.status === 200 && cert.headers.get('content-type') === 'application/pdf')
check('startReview -> IN_REVIEW', (await call(`Suppliers(${id})/SupplierService.startReview`, { auth: APPROVER, body: {} })).status === 204)
check('status IN_REVIEW visible to supplier', (await call('getMyApplication()', { method: 'GET', token })).json?.status === 'IN_REVIEW')
check('norole cannot approve -> 403', (await call(`Suppliers(${id})/SupplierService.approveApplication`, { auth: NOROLE, body: {} })).status === 403)

const noComment = await call(`Suppliers(${id})/SupplierService.rejectApplication`, { auth: APPROVER, body: { comment: '  ' } })
check('reject without comment -> 400', noComment.status === 400)
console.log('     message:', noComment.message)
const rej = await call(`Suppliers(${id})/SupplierService.rejectApplication`, {
  auth: APPROVER,
  body: { comment: 'Certificate scope does not cover cabling.', revisionFields: 'certificate,notes' }
})
check('reject with comment -> 204', rej.status === 204, JSON.stringify(rej.json))
const again = await call(`Suppliers(${id})/SupplierService.approveApplication`, { auth: APPROVER, body: {} })
check('second decision -> 409', again.status === 409)

console.log('\nRe-apply')
const mine = (await call('getMyApplication()', { method: 'GET', token })).json
check('supplier sees reason', mine.status === 'REJECTED' && mine.rejectionComment.startsWith('Certificate'), JSON.stringify(mine))
const locked = await call('saveApplication', { token, body: { ...form, companyName: 'Changed Name' } })
check('non-revisable field change -> 403', locked.status === 403, JSON.stringify(locked.json))
check('revisable field change ok', (await call('saveApplication', { token, body: { ...form, notes: 'Now incl. cabling' } })).status === 200)
check('resubmit without new certificate -> 400', (await call('submitApplication', { token, body: {} })).status === 400)
check('new certificate upload ok', (await upload(id, 'valid-certificate.pdf', token)).status === 204)
check('resubmit ok', (await call('submitApplication', { token, body: {} })).json?.status === 'SUBMITTED')

const counts = await call('getStatusCounts()', { method: 'GET', auth: APPROVER })
check('status counts', counts.json?.pending >= 1, JSON.stringify(counts.json))

console.log('\nAI analysis')
const ai = await call(`Suppliers(${id})/SupplierService.analyzeWithAI`, { auth: APPROVER, body: {} })
if (ai.status === 502) console.log('  - skipped (no AI destination reachable):', ai.message)
else {
  check('AI decision applied', ai.status === 200 && ['APPROVED', 'REJECTED'].includes(ai.json.status), JSON.stringify(ai.json))
  console.log('     AI:', ai.json?.decision, '-', ai.json?.reason)
}

await call('logout', { token, body: {} })
check('logout invalidates token', (await call('getMyApplication()', { method: 'GET', token })).status === 403)

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
