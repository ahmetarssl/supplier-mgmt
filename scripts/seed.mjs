
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = (process.env.BASE_URL ?? 'http://localhost:4004') + '/odata/v4/supplier'
const FILES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'files')
const PASSWORD = 'Demo!2026'

const suppliers = [
  {
    email: 'info@anadolu-elektronik.example',
    certificate: 'valid-certificate.pdf',
    form: {
      companyName: 'Anadolu Elektronik A.S.',
      contactPerson: 'Ayse Yilmaz',
      phone: '+90 312 555 01 01',
      country: 'Turkey',
      category: 'HARDWARE',
      taxNumber: '0681234567',
      website: 'https://anadolu-elektronik.example',
      address: 'OSB 3. Cadde No:12, Ankara',
      notes: 'PCBs, sensors and cabling'
    }
  },
  {
    email: 'contact@kuzey-yazilim.example',
    certificate: 'expired-certificate.pdf',
    form: {
      companyName: 'Kuzey Yazilim Ltd. Sti.',
      contactPerson: 'Mehmet Demir',
      phone: '+90 216 555 02 02',
      country: 'Turkey',
      category: 'SOFTWARE',
      taxNumber: '7350012345',
      website: 'https://kuzey-yazilim.example',
      address: 'Teknopark Istanbul, Pendik',
      notes: 'Custom ERP integrations'
    }
  },
  {
    email: 'hello@bremen-consulting.example',
    certificate: 'unrelated-document.pdf',
    form: {
      companyName: 'Bremen Consulting GmbH',
      contactPerson: 'Julia Becker',
      phone: '+49 421 555 0303',
      country: 'Germany',
      category: 'CONSULTING',
      taxNumber: 'DE812345678',
      website: 'https://bremen-consulting.example',
      address: 'Am Wall 10, 28195 Bremen',
      notes: 'SAP S/4HANA migration consulting'
    }
  },
  {
    email: 'sales@ege-lojistik.example',
    certificate: 'valid-certificate.pdf',
    form: {
      companyName: 'Ege Lojistik Hizmetleri',
      contactPerson: 'Can Ozturk',
      phone: '+90 232 555 04 04',
      country: 'Turkey',
      category: 'SERVICES',
      taxNumber: '3330098765',
      website: 'https://ege-lojistik.example',
      address: 'Alsancak, Izmir',
      notes: 'Warehousing and last-mile delivery'
    }
  }
]

async function call(name, { body, token, method = 'POST' } = {}) {
  const res = await fetch(`${BASE}/${name}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { 'X-Supplier-Token': token }) },
    body: JSON.stringify(body ?? {})
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${name}: ${res.status} ${json?.error?.message}`)
  return json
}

for (const s of suppliers) {
  let auth
  try {
    auth = await call('register', { body: { email: s.email, password: PASSWORD } })
  } catch {
    auth = await call('login', { body: { email: s.email, password: PASSWORD } })
  }
  const application = await call('saveApplication', { token: auth.token, body: s.form }).catch(e => ({ error: e }))
  if (application.error) {
    console.log(`- ${s.form.companyName}: already submitted, skipped`)
    continue
  }
  const upload = await fetch(`${BASE}/CertificateUploads(${application.ID})/certificate`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf', 'X-Supplier-Token': auth.token, slug: s.certificate },
    body: fs.readFileSync(path.join(FILES, s.certificate))
  })
  if (!upload.ok) throw new Error(`upload failed: ${upload.status}`)
  await call('submitApplication', { token: auth.token })
  console.log(`+ ${s.form.companyName} (${s.email}) submitted`)
}
console.log(`\nDemo password for all suppliers: ${PASSWORD}`)
