import { describe, expect, it } from 'vitest'

import { startContainer, type Docker } from './mongo-setup.js'

/** A stand-in for docker: records every call, and fails the first `fails` runs with `message` in stderr. */
function fakeDocker(fails: number, message: string) {
  const calls: string[][] = []
  let runs = 0
  const docker: Docker = (args) => {
    calls.push(args)
    if (args[0] === 'run' && runs++ < fails) throw Object.assign(new Error('docker failed'), { stderr: message })
  }
  return { calls, docker, runs: () => calls.filter((c) => c[0] === 'run'), removes: () => calls.filter((c) => c[0] === 'rm') }
}

const ports = () => {
  let next = 40000
  return async () => next++
}

describe('the throwaway MongoDB container', () => {
  it('sets up removal before the first start, so a Ctrl-C while starting removes it', async () => {
    const d = fakeDocker(0, '')
    let registered: (() => void) | undefined
    let runsWhenRegistered = -1
    await startContainer('c1', d.docker, ports(), (remove) => {
      registered = remove
      runsWhenRegistered = d.runs().length
    })
    expect(runsWhenRegistered).toBe(0)
    registered!()
    expect(d.removes()).toEqual([['rm', '-f', '-v', 'c1']])
    registered!()
    expect(d.removes()).toHaveLength(1)
  })

  it('removes nothing if stopped before any start', async () => {
    const d = fakeDocker(0, '')
    let registered: (() => void) | undefined
    const never = () => new Promise<number>(() => {})
    void startContainer('c2', d.docker, never, (remove) => (registered = remove))
    await Promise.resolve()
    registered!()
    expect(d.calls).toEqual([])
  })

  it('tries a new port when the port was taken, removing the failed container each time', async () => {
    const d = fakeDocker(2, 'Bind for 127.0.0.1:40000 failed: port is already allocated')
    const { port } = await startContainer('c3', d.docker, ports(), () => {})
    expect(port).toBe(40002)
    expect(d.runs()).toHaveLength(3)
    expect(d.removes()).toHaveLength(2)
  })

  it('gives up after five taken ports', async () => {
    const d = fakeDocker(9, 'address already in use')
    await expect(startContainer('c4', d.docker, ports(), () => {})).rejects.toThrow('docker failed')
    expect(d.runs()).toHaveLength(5)
  })

  it('throws at once on any other error, after removing what the failed start may have left', async () => {
    const d = fakeDocker(1, 'Unable to find image mongo:8 locally')
    await expect(startContainer('c5', d.docker, ports(), () => {})).rejects.toThrow('docker failed')
    expect(d.runs()).toHaveLength(1)
    expect(d.removes()).toEqual([['rm', '-f', '-v', 'c5']])
  })

  it('never removes a container that already had the name', async () => {
    const d = fakeDocker(1, 'Conflict. The container name "/c6" is already in use by container "abc123".')
    let registered: (() => void) | undefined
    await expect(startContainer('c6', d.docker, ports(), (remove) => (registered = remove))).rejects.toThrow('docker failed')
    registered!()
    expect(d.removes()).toEqual([])
  })
})
