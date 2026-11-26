import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import { removeOnExit } from './cleanup.js'

/** A stand-in for the process: it records the exit code, and exiting fires `exit` as Node does. */
function fakeProcess() {
  const events = new EventEmitter()
  const codes: number[] = []
  const proc = { once: events.once.bind(events), exit: (code: number) => (codes.push(code), events.emit('exit'), undefined as never) }
  return { codes, events, proc: proc as unknown as Parameters<typeof removeOnExit>[1] }
}

describe('test clean-up', () => {
  const endings: [string, number][] = [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]
  it.each(endings)('removes the database container on %s, then exits', (signal, code) => {
    const { codes, events, proc } = fakeProcess()
    let removed = 0
    // The real remover runs once however often it is called. This one counts every call.
    removeOnExit(() => removed++, proc)
    events.emit(signal)
    expect(removed).toBeGreaterThan(0)
    expect(codes).toEqual([code])
  })

  it('removes it on a normal exit', () => {
    const { events, proc } = fakeProcess()
    let removed = 0
    removeOnExit(() => removed++, proc)
    events.emit('exit')
    expect(removed).toBe(1)
  })
})
