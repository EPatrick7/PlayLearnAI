import { useEffect, useState } from 'react'

export type ToolRegistrationStatus = 'registering' | 'ready' | 'unavailable' | 'error'

interface RegistrationState {
  tools: WebMCP.ModelContextTool[]
  catalogKey: string
  status: ToolRegistrationStatus
}

const registrationAvailable = () =>
  typeof document !== 'undefined' &&
  typeof document.modelContext?.registerTool === 'function'

/** Keep the tools array stable until its catalog changes. */
export const useToolRegistration = (
  tools: WebMCP.ModelContextTool[],
  catalogKey: string,
): ToolRegistrationStatus => {
  const [registration, setRegistration] = useState<RegistrationState>(() => ({
    tools,
    catalogKey,
    status: registrationAvailable() ? 'registering' : 'unavailable',
  }))

  useEffect(() => {
    const modelContext = typeof document === 'undefined' ? undefined : document.modelContext
    const controller = new AbortController()
    let active = true

    const register = async () => {
      if (typeof modelContext?.registerTool !== 'function') {
        setRegistration({ tools, catalogKey, status: 'unavailable' })
        return
      }

      try {
        // The async callback also captures a host that throws synchronously, so
        // every started registration promise has a rejection handler.
        await Promise.all(
          tools.map(async (tool) =>
            modelContext.registerTool(tool, { signal: controller.signal }),
          ),
        )
        if (active) setRegistration({ tools, catalogKey, status: 'ready' })
      } catch (error) {
        if (!active) return

        // Registration is all-or-nothing: remove any tools already registered
        // and cancel pending registrations before reporting a failed catalog.
        controller.abort()
        console.error('Unable to register Moonbase WebMCP tools', error)
        setRegistration({ tools, catalogKey, status: 'error' })
      }
    }

    void register()
    return () => {
      active = false
      controller.abort()
    }
  }, [tools, catalogKey])

  if (registration.tools === tools && registration.catalogKey === catalogKey) {
    return registration.status
  }

  // A replacement catalog must never inherit the previous catalog's ready or
  // error status. Forget the superseded result during render so returning to a
  // previously used catalog cannot revive its already-aborted registration.
  const status = registrationAvailable() ? 'registering' : 'unavailable'
  setRegistration({ tools, catalogKey, status })
  return status
}
