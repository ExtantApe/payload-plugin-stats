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

/** Runs one docker command and throws on failure, with Docker's message in `stderr`. */
export type Docker = (args: string[]) => void

const messageOf = (error: unknown) => String((error as { stderr?: unknown }).stderr ?? error)

/**
 * Starts the throwaway container `name` on a free port and returns that port and a function that removes it.
 * Removal is set up before the first start, so a Ctrl-C or a kill while the container is still starting removes it
 * too. Only a container this run may have created is removed: if Docker says the name is taken by a container that
 * was already there, nothing is removed. A port taken between picking and binding gets a new port, up to five tries.
 */
export async function startContainer(
  name: string,
  docker: Docker,
  pickPort: () => Promise<number>,
  onExit: (remove: () => void) => void = removeOnExit,
): Promise<{ port: number; remove: () => void }> {
  let mayExist = false
  const remove = () => {
    if (!mayExist) return
    mayExist = false
    try {
      docker(['rm', '-f', '-v', name])
    } catch {
      // already gone
    }
  }
  onExit(remove)
  for (let tries = 1; ; tries++) {
    const port = await pickPort()
    mayExist = true
    try {
      docker(['run', '-d', '--rm', '--name', name, '--tmpfs', '/data/db', '-p', `127.0.0.1:${port}:27017`, 'mongo:8'])
      return { port, remove }
    } catch (error) {
      const message = messageOf(error)
      if (/is already in use by container/i.test(message)) {
        // Someone else's container has this name. It isn't ours to remove.
        mayExist = false
        throw error
      }
      // A failed start can leave the container behind, created and never run.
      remove()
      if (!/port is already allocated|address already in use/i.test(message) || tries >= 5) throw error
    }
  }
}

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
  const name = `payload-plugin-stats-test-${process.pid}-${Date.now()}`
  const docker: Docker = (args) => {
    execFileSync('docker', args, { stdio: 'pipe' })
  }
  const { port, remove } = await startContainer(name, docker, freePort)
  try {
    for (let tries = 0; ; tries++) {
      try {
        docker(['exec', name, 'mongosh', '--quiet', '--eval', 'db.runCommand({ ping: 1 }).ok'])
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
