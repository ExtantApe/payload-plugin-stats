import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'

import type { TestProject } from 'vitest/node'

import { removeOnExit } from './cleanup.js'

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUrl: string
  }
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })

/**
 * A real MongoDB for the integration tests. With STATS_TEST_MONGO_URL set (CI's service container) it uses that.
 * Otherwise it starts its own throwaway container on a free local port, keeps the data in memory, and removes that
 * one container by name when the run ends: pass, fail, Ctrl-C or a kill. It touches no other container.
 */
export default async function setup(project: TestProject) {
  const given = process.env.STATS_TEST_MONGO_URL
  if (given) {
    project.provide('mongoUrl', given)
    return
  }
  const port = await freePort()
  const name = `payload-plugin-stats-test-${process.pid}-${Date.now()}`
  execFileSync('docker', ['run', '-d', '--rm', '--name', name, '--tmpfs', '/data/db', '-p', `127.0.0.1:${port}:27017`, 'mongo:8'], { stdio: 'pipe' })
  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    try {
      execFileSync('docker', ['rm', '-f', '-v', name], { stdio: 'pipe' })
    } catch {
      // already gone
    }
  }
  removeOnExit(remove)
  try {
    for (let tries = 0; ; tries++) {
      try {
        execFileSync('docker', ['exec', name, 'mongosh', '--quiet', '--eval', 'db.runCommand({ ping: 1 }).ok'], { stdio: 'pipe' })
        break
      } catch (error) {
        if (tries > 60) throw error
        await new Promise((r) => setTimeout(r, 500))
      }
    }
  } catch (error) {
    remove()
    throw error
  }
  project.provide('mongoUrl', `mongodb://127.0.0.1:${port}/stats-test`)
  return remove
}
