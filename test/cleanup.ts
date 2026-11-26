/** How a test process can end, and the exit code each ending gives. */
const SIGNALS = [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]] as const

type Ending = Pick<NodeJS.Process, 'exit' | 'once'>

/**
 * Runs `remove` however the process ends: a normal exit, Ctrl-C, a kill or a closed terminal. Node skips its `exit`
 * event when a signal ends the process, so each signal gets its own handler, which removes and then exits.
 */
export function removeOnExit(remove: () => void, proc: Ending = process): void {
  proc.once('exit', remove)
  for (const [signal, code] of SIGNALS)
    proc.once(signal, () => {
      remove()
      proc.exit(code)
    })
}
