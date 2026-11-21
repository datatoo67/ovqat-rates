// Fetches the Central Bank of Azerbaijan's official daily bulletin and stores it verbatim.
//
// Bounded on purpose: ONE fixed URL pattern (no input), one request per attempt, at most two attempts,
// a hard timeout, and nothing is written unless the document is a real bulletin that is not older than
// what is already published. A failure leaves the published files untouched ("fail closed").
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const HOST = 'https://cbar.az/currencies/'
const TIMEOUT_MS = 20000
const ATTEMPTS = 2
const MIN_VALUTES = 15

const pad = n => String(n).padStart(2, '0')
const baku = new Date(Date.now() + 4 * 3600 * 1000) // Asia/Baku is UTC+4 all year
const requested = `${pad(baku.getUTCDate())}.${pad(baku.getUTCMonth() + 1)}.${baku.getUTCFullYear()}`
const url = `${HOST}${requested}.xml`

const parseDate = s => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s || '')
  if (!m) return null
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]))
  return d.getUTCDate() === +m[1] && d.getUTCMonth() === +m[2] - 1 ? d : null
}
const iso = d => d.toISOString().slice(0, 10)

export const validate = xml => {
  const head = /<ValCurs\b[^>]*\bDate="([^"]+)"/.exec(xml)
  if (!head) throw new Error('not a CBA bulletin (no ValCurs element)')
  const effective = parseDate(head[1])
  if (!effective) throw new Error(`unreadable bulletin date "${head[1]}"`)
  const day = 86400000
  const bakuToday = Date.UTC(baku.getUTCFullYear(), baku.getUTCMonth(), baku.getUTCDate())
  if (effective.getTime() > bakuToday + day) throw new Error('bulletin date is in the future')
  if (effective.getTime() < bakuToday - 14 * day) throw new Error('bulletin date is more than 14 days old')
  const codes = new Map()
  for (const m of xml.matchAll(/<Valute\b[^>]*\bCode="([A-Z]{3})"[^>]*>([\s\S]*?)<\/Valute>/g)) {
    const v = Number(String((/<Value>([\s\S]*?)<\/Value>/.exec(m[2]) || [])[1] || '').replace(',', '.'))
    const nominal = parseFloat((/<Nominal>\s*([\d.,]+)/.exec(m[2]) || [])[1] || '')
    if (Number.isFinite(v) && v > 0 && Number.isFinite(nominal) && nominal > 0) codes.set(m[1], v / nominal)
  }
  if (codes.size < MIN_VALUTES) throw new Error(`only ${codes.size} usable currencies`)
  // The manat is pegged near 1.7 per dollar; a wildly different number is not a bulletin we publish.
  const usd = codes.get('USD')
  if (!usd || usd < 1 || usd > 3) throw new Error(`implausible USD rate ${usd}`)
  if (!codes.get('EUR')) throw new Error('EUR missing')
  return { effective, count: codes.size }
}

const fetchOnce = async () => {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/xml,text/xml;q=0.9' },
    redirect: 'error'
  })
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
  const type = res.headers.get('content-type') || ''
  if (/text\/html/i.test(type)) throw new Error(`unexpected content type ${type}`)
  return res.text()
}

let xml = null
let lastError = null
for (let i = 1; i <= ATTEMPTS && !xml; i++) {
  try {
    xml = await fetchOnce()
  } catch (e) {
    lastError = e
    console.log(`attempt ${i}/${ATTEMPTS} failed: ${e.message}`)
    if (i < ATTEMPTS) await new Promise(r => setTimeout(r, 3000))
  }
}
if (!xml) {
  console.log(`::warning::CBA unreachable (${lastError && lastError.message}); published files kept`)
  process.exit(0)
}
const { effective, count } = validate(xml)
const effectiveIso = iso(effective)
mkdirSync('cba/archive', { recursive: true })
let current = null
if (existsSync('cba/meta.json')) current = JSON.parse(readFileSync('cba/meta.json', 'utf8'))
if (current && current.effectiveDate > effectiveIso) {
  console.log(`bulletin ${effectiveIso} is older than published ${current.effectiveDate}; ignored`)
  process.exit(0)
}
const sha256 = createHash('sha256').update(xml).digest('hex')
if (current && current.effectiveDate === effectiveIso && current.sha256 === sha256) {
  console.log(`bulletin ${effectiveIso} unchanged`)
  process.exit(0)
}
writeFileSync('cba/latest.xml', xml)
writeFileSync(`cba/archive/${effectiveIso}.xml`, xml)
writeFileSync(
  'cba/meta.json',
  JSON.stringify(
    {
      source: 'CBA',
      sourceUrl: url,
      requestedDate: requested,
      effectiveDate: effectiveIso,
      fetchedAt: new Date().toISOString(),
      sha256,
      currencies: count
    },
    null,
    2
  ) + '\n'
)
console.log(`published CBA bulletin effective ${effectiveIso} (${count} currencies)`)
