import { StrictMode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToolRegistration } from './useToolRegistration'

const originalModelContextDescriptor = Object.getOwnPropertyDescriptor(document, 'modelContext')

const installModelContext = (modelContext: unknown) => {
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: modelContext,
  })
}

const makeTools = (...names: string[]): WebMCP.ModelContextTool[] =>
  names.map((name) => ({
    name,
    description: `Test tool ${name}`,
    inputSchema: { type: 'object', additionalProperties: false },
    execute: () => ({ content: [{ type: 'text', text: name }] }),
  }))

const deferred = () => {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalModelContextDescriptor) {
    Object.defineProperty(document, 'modelContext', originalModelContextDescriptor)
  } else {
    Reflect.deleteProperty(document, 'modelContext')
  }
})

describe('WebMCP tool registration lifecycle', () => {
  it.each([undefined, null, {}, { registerTool: true }])(
    'reports an unavailable host for %s without throwing',
    (modelContext) => {
      installModelContext(modelContext)
      const tools = makeTools('inspect')
      const hook = renderHook(() => useToolRegistration(tools, 'landing'))

      expect(hook.result.current).toBe('unavailable')
    },
  )

  it('waits for every registration and preserves the host method receiver', async () => {
    const first = deferred()
    const second = deferred()
    const tools = makeTools('inspect', 'manage')
    const modelContext = {
      registerTool: vi.fn(function (this: unknown, tool: WebMCP.ModelContextTool) {
        expect(this).toBe(modelContext)
        return tool.name === 'inspect' ? first.promise : second.promise
      }),
    }
    installModelContext(modelContext)
    const hook = renderHook(() => useToolRegistration(tools, 'landing'))

    expect(hook.result.current).toBe('registering')
    await act(async () => first.resolve())
    expect(hook.result.current).toBe('registering')
    await act(async () => second.resolve())
    expect(hook.result.current).toBe('ready')
    expect(modelContext.registerTool).toHaveBeenCalledTimes(2)
  })

  it.each([new Error('Registration rejected'), new DOMException('Registration aborted', 'AbortError')])(
    'rolls back partial registration on a host failure: %s',
    async (failure) => {
      const gates = [deferred(), deferred(), deferred()]
      const tools = makeTools('inspect', 'manage', 'place')
      const registered = new Set<string>()
      const signals: AbortSignal[] = []
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      installModelContext({
        registerTool: vi.fn(async (
          tool: WebMCP.ModelContextTool,
          options: WebMCP.ModelContextRegisterToolOptions,
        ) => {
          const signal = options.signal!
          signals.push(signal)
          await gates[tools.indexOf(tool)].promise
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          registered.add(tool.name)
          signal.addEventListener('abort', () => registered.delete(tool.name), { once: true })
        }),
      })
      const hook = renderHook(() => useToolRegistration(tools, 'landing'))

      await act(async () => gates[0].resolve())
      expect([...registered]).toEqual(['inspect'])
      expect(hook.result.current).toBe('registering')

      await act(async () => gates[1].reject(failure))
      expect(hook.result.current).toBe('error')
      expect(registered.size).toBe(0)
      expect(signals).toHaveLength(3)
      expect(signals.every((signal) => signal.aborted)).toBe(true)
      expect(new Set(signals).size).toBe(1)
      expect(errorLog).toHaveBeenCalledExactlyOnceWith(
        'Unable to register Moonbase WebMCP tools', failure,
      )

      await act(async () => gates[2].resolve())
      expect(registered.size).toBe(0)
      expect(hook.result.current).toBe('error')
    },
  )

  it('handles a synchronous host throw while other registration promises are pending', async () => {
    const pending = deferred()
    const signals: AbortSignal[] = []
    const tools = makeTools('inspect', 'manage')
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    installModelContext({
      registerTool: vi.fn((
        tool: WebMCP.ModelContextTool,
        options: WebMCP.ModelContextRegisterToolOptions,
      ) => {
        signals.push(options.signal!)
        if (tool.name === 'manage') throw new Error('Synchronous host failure')
        return pending.promise
      }),
    })
    const hook = renderHook(() => useToolRegistration(tools, 'landing'))

    await waitFor(() => expect(hook.result.current).toBe('error'))
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    await act(async () => pending.reject(new Error('Late rejection')))
    expect(errorLog).toHaveBeenCalledTimes(1)
    expect(hook.result.current).toBe('error')
  })

  it('cleans up the StrictMode probe without unregistering the active catalog', async () => {
    const tools = makeTools('inspect', 'manage')
    const registrations: Array<{ name: string; signal: AbortSignal }> = []
    const active = new Map<string, AbortSignal>()
    installModelContext({
      registerTool: vi.fn(async (
        tool: WebMCP.ModelContextTool,
        options: WebMCP.ModelContextRegisterToolOptions,
      ) => {
        const signal = options.signal!
        registrations.push({ name: tool.name, signal })
        active.set(tool.name, signal)
        signal.addEventListener('abort', () => {
          if (active.get(tool.name) === signal) active.delete(tool.name)
        }, { once: true })
      }),
    })
    const hook = renderHook(() => useToolRegistration(tools, 'landing'), { wrapper: StrictMode })

    await waitFor(() => expect(hook.result.current).toBe('ready'))
    expect(registrations).toHaveLength(4)
    expect(registrations.slice(0, 2).every(({ signal }) => signal.aborted)).toBe(true)
    expect(registrations.slice(2).every(({ signal }) => !signal.aborted)).toBe(true)
    expect([...active.keys()]).toEqual(['inspect', 'manage'])

    hook.unmount()
    expect(active.size).toBe(0)
    expect(registrations.every(({ signal }) => signal.aborted)).toBe(true)
  })

  it('immediately reports registering on catalog changes and retires the previous catalog', async () => {
    const landing = makeTools('inspect_construction')
    const operations = makeTools('inspect_operations', 'stage_plan')
    const operationGate = deferred()
    const signals: AbortSignal[] = []
    installModelContext({
      registerTool: vi.fn((
        tool: WebMCP.ModelContextTool,
        options: WebMCP.ModelContextRegisterToolOptions,
      ) => {
        signals.push(options.signal!)
        return landing.includes(tool) ? Promise.resolve() : operationGate.promise
      }),
    })
    const observed: Array<{ catalog: string; status: string }> = []
    const hook = renderHook(({ catalog }) => {
      const status = useToolRegistration(catalog === 'landing' ? landing : operations, catalog)
      observed.push({ catalog, status })
      return status
    }, { initialProps: { catalog: 'landing' } })

    await waitFor(() => expect(hook.result.current).toBe('ready'))
    hook.rerender({ catalog: 'operations' })

    expect(observed.find(({ catalog }) => catalog === 'operations')?.status).toBe('registering')
    expect(hook.result.current).toBe('registering')
    expect(signals[0].aborted).toBe(true)
    expect(signals.slice(1).every((signal) => !signal.aborted)).toBe(true)

    await act(async () => operationGate.resolve())
    expect(hook.result.current).toBe('ready')
  })

  it.each(['resolve', 'reject'] as const)(
    'ignores a late %s from an obsolete catalog',
    async (settle) => {
      const oldCatalog = makeTools('old_tool')
      const newCatalog = makeTools('new_tool')
      const oldGate = deferred()
      const newGate = deferred()
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      installModelContext({
        registerTool: vi.fn((tool: WebMCP.ModelContextTool) =>
          oldCatalog.includes(tool) ? oldGate.promise : newGate.promise,
        ),
      })
      const hook = renderHook(
        ({ catalog }) => useToolRegistration(catalog === 'old' ? oldCatalog : newCatalog, catalog),
        { initialProps: { catalog: 'old' } },
      )

      hook.rerender({ catalog: 'new' })
      await act(async () => oldGate[settle](new Error('Old host request failed')))
      expect(hook.result.current).toBe('registering')
      expect(errorLog).not.toHaveBeenCalled()

      await act(async () => newGate.resolve())
      expect(hook.result.current).toBe('ready')
    },
  )

  it('registers again when returning to a cached catalog while its replacement is pending', async () => {
    const landing = makeTools('inspect_construction')
    const operations = makeTools('inspect_operations')
    const firstGate = deferred()
    const replacementGate = deferred()
    const returnGate = deferred()
    const registerTool = vi.fn()
      .mockReturnValueOnce(firstGate.promise)
      .mockReturnValueOnce(replacementGate.promise)
      .mockReturnValueOnce(returnGate.promise)
    installModelContext({ registerTool })
    const hook = renderHook(
      ({ catalog }) => useToolRegistration(catalog === 'landing' ? landing : operations, catalog),
      { initialProps: { catalog: 'landing' } },
    )

    await act(async () => firstGate.resolve())
    expect(hook.result.current).toBe('ready')
    hook.rerender({ catalog: 'operations' })
    expect(hook.result.current).toBe('registering')
    hook.rerender({ catalog: 'landing' })
    expect(hook.result.current).toBe('registering')
    expect(registerTool).toHaveBeenCalledTimes(3)

    await act(async () => replacementGate.resolve())
    expect(hook.result.current).toBe('registering')
    await act(async () => returnGate.resolve())
    expect(hook.result.current).toBe('ready')
  })

  it.each(['resolve', 'reject'] as const)(
    'aborts on unmount and ignores a late %s',
    async (settle) => {
      const tools = makeTools('inspect')
      const gate = deferred()
      const signals: AbortSignal[] = []
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      installModelContext({
        registerTool: vi.fn((
          _tool: WebMCP.ModelContextTool,
          options: WebMCP.ModelContextRegisterToolOptions,
        ) => {
          signals.push(options.signal!)
          return gate.promise
        }),
      })
      const hook = renderHook(() => useToolRegistration(tools, 'landing'))

      hook.unmount()
      expect(signals[0].aborted).toBe(true)
      await act(async () => gate[settle](new Error('Host request failed after unmount')))
      expect(errorLog).not.toHaveBeenCalled()
    },
  )

  it('retries failed registration only when a new catalog is requested', async () => {
    const tools = makeTools('inspect')
    const retryGate = deferred()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const registerTool = vi.fn()
      .mockRejectedValueOnce(new Error('Host temporarily failed'))
      .mockReturnValueOnce(retryGate.promise)
    installModelContext({ registerTool })
    const hook = renderHook(({ catalog }) => useToolRegistration(tools, catalog), {
      initialProps: { catalog: 'landing' },
    })

    await waitFor(() => expect(hook.result.current).toBe('error'))
    hook.rerender({ catalog: 'landing' })
    expect(registerTool).toHaveBeenCalledTimes(1)

    hook.rerender({ catalog: 'operations' })
    expect(hook.result.current).toBe('registering')
    expect(registerTool).toHaveBeenCalledTimes(2)
    await act(async () => retryGate.resolve())
    expect(hook.result.current).toBe('ready')
    expect(errorLog).toHaveBeenCalledTimes(1)
  })

  it('can discover a newly available host when the catalog changes', async () => {
    const tools = makeTools('inspect')
    installModelContext(undefined)
    const hook = renderHook(({ catalog }) => useToolRegistration(tools, catalog), {
      initialProps: { catalog: 'landing' },
    })
    expect(hook.result.current).toBe('unavailable')

    const registerTool = vi.fn().mockResolvedValue(undefined)
    installModelContext({ registerTool })
    hook.rerender({ catalog: 'operations' })

    await waitFor(() => expect(hook.result.current).toBe('ready'))
    expect(registerTool).toHaveBeenCalledTimes(1)
  })
})
