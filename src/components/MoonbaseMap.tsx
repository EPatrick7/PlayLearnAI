import type {
  CrewMember,
  Equipment,
  ModuleState,
  OperationsPlan,
  WorkOrder,
} from '../game/types'

interface MoonbaseMapProps {
  width: number
  height: number
  modules: ModuleState[]
  crew: CrewMember[]
  equipment: Equipment[]
  workOrders: WorkOrder[]
  plan: OperationsPlan
  dustActive: boolean
  selectedModuleId: string
  onInspectModule: (moduleId: string) => void
}

const moduleCode: Record<ModuleState['type'], string> = {
  habitat: 'HAB',
  corridor: 'LINK',
  life_support: 'ECLSS',
  storage: 'STORE',
  laboratory: 'LAB',
  airlock: 'LOCK',
  solar_battery_skid: 'PWR',
  landing_pad: 'PAD',
}

const equipmentCode: Record<Equipment['type'], string> = {
  eva_suit: 'EVA',
  engineering_kit: 'ENG',
  medical_kit: 'MED',
  rover: 'RVR',
}

const isExterior = (module: ModuleState) =>
  module.type === 'solar_battery_skid' || module.type === 'landing_pad'

export function MoonbaseMap({
  width,
  height,
  modules,
  crew,
  equipment,
  workOrders,
  plan,
  dustActive,
  selectedModuleId,
  onInspectModule,
}: MoonbaseMapProps) {
  const plannedWorkIds = new Set(
    plan.status === 'draft' ? plan.actions.map((action) => action.workOrderId) : [],
  )
  const plannedLocations = new Set(
    workOrders.filter((order) => plannedWorkIds.has(order.id)).map((order) => order.location),
  )

  const markerPosition = (location: CrewMember['location'], index: number) => {
    const module = modules.find((candidate) => candidate.location === location) ?? modules[0]
    const columnsInside = Math.max(1, module.position.width - 1)
    return {
      gridColumn: `${module.position.x + 1 + (index % columnsInside)} / span 1`,
      gridRow: `${module.position.y + 1 + (Math.floor(index / columnsInside) % Math.max(1, module.position.height - 1))} / span 1`,
    }
  }

  return (
    <div
      aria-label="Top-down map of Shackleton Base"
      className={`moonbase-map ${dustActive ? 'dust-active' : ''}`}
      role="group"
      style={{
        gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${height}, minmax(0, 1fr))`,
      }}
    >
      <div className="map-grid" aria-hidden="true" />
      <div className="ridge ridge-a" aria-hidden="true" />
      <div className="ridge ridge-b" aria-hidden="true" />
      <div className="crater crater-a" aria-hidden="true" />
      <div className="crater crater-b" aria-hidden="true" />

      {modules.map((module) => {
        const exterior = isExterior(module)
        const planned = plannedLocations.has(module.location)
        return (
          <button
            aria-label={`Inspect ${module.name}. ${exterior ? 'Exterior' : `Atmosphere ${module.atmosphere}`}. Condition ${module.condition} percent${module.breached ? '. Breached' : ''}.`}
            className={[
              'base-module',
              `module-${module.type}`,
              exterior ? 'exterior' : `atmosphere-${module.atmosphere}`,
              module.breached ? 'breached' : '',
              planned ? 'planned' : '',
              selectedModuleId === module.id ? 'selected' : '',
            ].filter(Boolean).join(' ')}
            key={module.id}
            onClick={() => onInspectModule(module.id)}
            style={{
              gridColumn: `${module.position.x + 1} / span ${module.position.width}`,
              gridRow: `${module.position.y + 1} / span ${module.position.height}`,
            }}
            type="button"
          >
            <span className="module-code">{moduleCode[module.type]}</span>
            <strong>{module.name}</strong>
            <small>
              {exterior
                ? `${module.condition}% condition`
                : `${module.atmosphere.toUpperCase()} · ${module.condition}%`}
            </small>
            {module.breached && <i className="breach-marker" aria-hidden="true" />}
            {planned && <span className="planned-tag">staged</span>}
          </button>
        )
      })}

      {crew.map((member, index) => (
        <div
          className={`crew-marker ${member.status}`}
          key={member.id}
          style={markerPosition(member.location, index)}
          title={`${member.name} — ${member.status}`}
        >
          <span>{member.name.split(' ').map((part) => part[0]).join('')}</span>
        </div>
      ))}

      {equipment.map((item, index) => (
        <div
          className={`equipment-marker ${item.status}`}
          key={item.id}
          style={markerPosition(item.location, index + crew.length)}
          title={`${item.name} — ${item.status} at ${item.location}`}
        >
          {equipmentCode[item.type]}
        </div>
      ))}

      <div className="map-north" aria-hidden="true"><span>N</span><i /></div>
      <div className="map-scale" aria-hidden="true"><i />20 m</div>
    </div>
  )
}
