const ID = 'dsh-delivery-orchestrator'
const SLOT_ID = 'delivery-orchestrator'

function sessionIdOf(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return value.sessionId || value.session?.sessionId || ''
  return ''
}
function asStream(value) {
  if (value && typeof value[Symbol.asyncIterator] === 'function') return value
  if (value && typeof value.iterate === 'function') return value.iterate()
  return null
}

window.__ModuleLoader__?.load({
  id: ID,
  factory(require) {
    const React = require('react')
    const { useEffect, useMemo, useState } = React
    function DeliveryGraph({ remote, sessionId }) {
      const [runs, setRuns] = useState([])
      const [error, setError] = useState('')
      useEffect(() => {
        if (!remote || !sessionId) return undefined
        const controller = new AbortController()
        let alive = true
        Promise.resolve(remote.status({ sessionId })).then(value => {
          if (!alive) return
          const list = Array.isArray(value) ? value : value ? [value] : []
          setRuns(list)
        }).catch(reason => alive && setError(reason?.message || 'status unavailable'))
        ;(async () => {
          try {
            const stream = asStream(await remote.watch({ sessionId }, controller.signal))
            if (!stream) return
            for await (const frame of stream) {
              if (!alive) break
              if (frame?.type === 'run' && frame.run) setRuns(current => { const next = current.filter(run => run.runId !== frame.run.runId); return [...next, frame.run] })
            }
          } catch (reason) { if (alive && reason?.name !== 'AbortError') setError(reason?.message || 'watch unavailable') }
        })()
        return () => { alive = false; controller.abort() }
      }, [remote, sessionId])
      const ordered = useMemo(() => [...runs].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))), [runs])
      if (!sessionId) return null
      return React.createElement('section', { className: 'dsh-delivery-graph', 'aria-label': 'Delivery runs' },
        React.createElement('header', { className: 'dsh-delivery-graph__header' }, React.createElement('strong', null, 'Delivery runs'), error && React.createElement('span', { role: 'status' }, error)),
        ordered.length === 0 ? React.createElement('p', { className: 'dsh-delivery-graph__empty' }, 'No delivery runs for this session.') : ordered.map(run => React.createElement('article', { key: run.runId, className: 'dsh-delivery-run' },
          React.createElement('div', { className: 'dsh-delivery-run__title' }, React.createElement('strong', null, run.runId), React.createElement('span', null, run.state)),
          React.createElement('ol', { className: 'dsh-delivery-run__units' }, (run.units || []).map(unit => React.createElement('li', { key: unit.id, className: `dsh-delivery-unit dsh-delivery-unit--${String(unit.state || '').toLowerCase()}` }, React.createElement('span', null, unit.title || unit.id), React.createElement('b', null, unit.state))))
        ))
      )
    }
    return {
      name: ID,
      inject: ['slots', 'remote'],
      apply(ctx) {
        let remote
        ctx.inject(['remote.delivery'], injected => { remote = injected.get('remote.delivery') })
        ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock', id: SLOT_ID, order: 80, label: () => 'Delivery runs',
          inject: session => ({ remote, sessionId: sessionIdOf(session) }),
        }, DeliveryGraph)), `${ID}.dock`)
      },
    }
  },
})
