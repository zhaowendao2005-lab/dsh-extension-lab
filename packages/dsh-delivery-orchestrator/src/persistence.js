import { createHash, randomUUID } from 'node:crypto'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const deepClone = value => structuredClone(value)
export const uuid = randomUUID
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const domainSpec = defineDomain({
  name: 'dsh_delivery_orchestrator', version: 3, layout: 'per-record',
  tables: { runs: domainTable(z.object({ id: z.string().min(1), owner: z.string().min(1), schemaVersion: z.literal('DeliveryRunV3') }).passthrough()) },
})

/** No silent memory fallback: a failed durable commit is a failed transition. */
export class PersistentLedger {
  constructor(ctx) {
    this.chain = Promise.resolve()
    this.closed = false
    this.ready = ctx.storageDomain.open(domainSpec).then(domain => { this.domain = domain; this.table = domain.table('runs') })
    this.ready.catch(() => {})
  }
  async values() { await this.ready; return [...this.table.entries()].map(([, row]) => deepClone(row)) }
  async get(id) { await this.ready; const row = this.table.get(id); return row && deepClone(row) }
  transact(id, update) {
    const action = this.chain.then(async () => {
      if (this.closed) throw new Error('LEDGER_CLOSED')
      await this.ready
      const old = this.table.get(id)
      const next = await update(old && deepClone(old))
      if (Buffer.byteLength(JSON.stringify(next)) > 24 * 1024 * 1024) throw new Error('LEDGER_RECORD_LIMIT')
      await this.table.put(id, deepClone(next))
      return deepClone(next)
    })
    this.chain = action.catch(() => {}) // failures are returned, not allowed to poison later cleanup commits
    return action
  }
  async close() { await this.chain; this.closed = true; await this.ready; await this.domain.close() }
}
