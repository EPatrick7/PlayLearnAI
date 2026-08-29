import type { CSSProperties } from "react";

import type { ModuleState, ModuleType } from "../game/types";
import { GameIcon, type GameIconName } from "./GameIcon";

interface GridPoint {
  x: number;
  y: number;
}

type CardinalSide = "north" | "east" | "south" | "west";
type TileKind = "wall" | "floor" | "door" | "corridor" | "solar" | "landing-pad";

interface DoorCell extends GridPoint {
  sides: CardinalSide[];
  connectedModuleIds: string[];
}

interface FixturePlacement {
  id: string;
  kind:
    | "bed"
    | "mess-table"
    | "hab-console"
    | "life-tanks"
    | "scrubber"
    | "life-console"
    | "lab-bench"
    | "analysis-bench"
    | "microscope"
    | "lab-console"
    | "storage-rack"
    | "airlock-chamber"
    | "suit-rack"
    | "solar-bank"
    | "battery-bank"
    | "landing-target";
  label: string;
  icon: GameIconName;
  x: number;
  y: number;
  width: number;
  height: number;
  segments: number;
}

interface InteriorPartition {
  side: CardinalSide;
  opening?: boolean;
}

interface ModuleTilemapProps {
  module: ModuleState;
  modules: ModuleState[];
  selected: boolean;
  planned: boolean;
  ghost?: boolean;
}

interface ConnectorCell extends GridPoint {
  id: string;
  fromModuleId: string;
  toModuleId: string;
  orientation: "horizontal" | "vertical";
}

const exteriorModuleTypes = new Set<ModuleType>(["solar_battery_skid", "landing_pad"]);

const cellKey = (x: number, y: number) => `${x}:${y}`;

const boundedMidpoint = (start: number, end: number) =>
  Math.max(start, Math.min(end, Math.floor((start + end) / 2)));

const localMidpoint = (length: number) => {
  if (length <= 2) return 0;
  return Math.max(1, Math.min(length - 2, Math.floor((length - 1) / 2)));
};

const moduleCenter = (module: ModuleState) => ({
  x: module.position.x + (module.position.width - 1) / 2,
  y: module.position.y + (module.position.height - 1) / 2,
});

const isExteriorModule = (module: ModuleState) => exteriorModuleTypes.has(module.type);

const touchingDoorCells = (module: ModuleState, modules: ModuleState[]): DoorCell[] => {
  if (isExteriorModule(module)) return [];

  const cells = new Map<string, DoorCell>();
  const left = module.position.x;
  const right = left + module.position.width - 1;
  const top = module.position.y;
  const bottom = top + module.position.height - 1;

  const add = (x: number, y: number, side: CardinalSide, connectedModuleId: string) => {
    const key = cellKey(x, y);
    const existing = cells.get(key);
    if (existing) {
      if (!existing.sides.includes(side)) existing.sides.push(side);
      if (!existing.connectedModuleIds.includes(connectedModuleId)) {
        existing.connectedModuleIds.push(connectedModuleId);
      }
      return;
    }
    cells.set(key, { x, y, sides: [side], connectedModuleIds: [connectedModuleId] });
  };

  for (const other of modules) {
    if (other.id === module.id || isExteriorModule(other)) continue;
    const canUseGapConnector = module.type === "corridor" || other.type === "corridor";

    const otherLeft = other.position.x;
    const otherRight = otherLeft + other.position.width - 1;
    const otherTop = other.position.y;
    const otherBottom = otherTop + other.position.height - 1;

    const verticalStart = Math.max(top, otherTop);
    const verticalEnd = Math.min(bottom, otherBottom);
    if (verticalStart <= verticalEnd) {
      const doorwayY = boundedMidpoint(verticalStart, verticalEnd);
      if (
        right === otherLeft ||
        right + 1 === otherLeft ||
        (canUseGapConnector && right + 2 === otherLeft)
      ) {
        add(right, doorwayY, "east", other.id);
      }
      if (
        otherRight === left ||
        otherRight + 1 === left ||
        (canUseGapConnector && otherRight + 2 === left)
      ) {
        add(left, doorwayY, "west", other.id);
      }
    }

    const horizontalStart = Math.max(left, otherLeft);
    const horizontalEnd = Math.min(right, otherRight);
    if (horizontalStart <= horizontalEnd) {
      const doorwayX = boundedMidpoint(horizontalStart, horizontalEnd);
      if (
        bottom === otherTop ||
        bottom + 1 === otherTop ||
        (canUseGapConnector && bottom + 2 === otherTop)
      ) {
        add(doorwayX, bottom, "south", other.id);
      }
      if (
        otherBottom === top ||
        otherBottom + 1 === top ||
        (canUseGapConnector && otherBottom + 2 === top)
      ) {
        add(doorwayX, top, "north", other.id);
      }
    }
  }

  return [...cells.values()];
};

const fallbackDoorCell = (module: ModuleState, modules: ModuleState[]): DoorCell | null => {
  if (isExteriorModule(module)) return null;

  if (module.type === "corridor") {
    return {
      x: module.position.x,
      y: module.position.y + localMidpoint(module.position.height),
      sides: ["west"],
      connectedModuleIds: [],
    };
  }

  const center = moduleCenter(module);
  const nearest = modules
    .filter((candidate) => candidate.id !== module.id && !isExteriorModule(candidate))
    .map((candidate) => {
      const candidateCenter = moduleCenter(candidate);
      return {
        center: candidateCenter,
        distance: Math.hypot(candidateCenter.x - center.x, candidateCenter.y - center.y),
      };
    })
    .sort((a, b) => a.distance - b.distance)[0]?.center;

  const dx = (nearest?.x ?? center.x + 1) - center.x;
  const dy = (nearest?.y ?? center.y) - center.y;
  const middleX = module.position.x + localMidpoint(module.position.width);
  const middleY = module.position.y + localMidpoint(module.position.height);

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx < 0
      ? { x: module.position.x, y: middleY, sides: ["west"], connectedModuleIds: [] }
      : {
          x: module.position.x + module.position.width - 1,
          y: middleY,
          sides: ["east"],
          connectedModuleIds: [],
        };
  }

  return dy < 0
    ? { x: middleX, y: module.position.y, sides: ["north"], connectedModuleIds: [] }
    : {
        x: middleX,
        y: module.position.y + module.position.height - 1,
        sides: ["south"],
        connectedModuleIds: [],
      };
};

const connectorCellsFor = (modules: ModuleState[]): ConnectorCell[] => {
  const connectors: ConnectorCell[] = [];

  modules.forEach((module, moduleIndex) => {
    if (isExteriorModule(module)) return;
    const left = module.position.x;
    const right = left + module.position.width - 1;
    const top = module.position.y;
    const bottom = top + module.position.height - 1;

    modules.slice(moduleIndex + 1).forEach((other) => {
      if (isExteriorModule(other)) return;
      if (module.type !== "corridor" && other.type !== "corridor") return;
      const otherLeft = other.position.x;
      const otherRight = otherLeft + other.position.width - 1;
      const otherTop = other.position.y;
      const otherBottom = otherTop + other.position.height - 1;

      const verticalStart = Math.max(top, otherTop);
      const verticalEnd = Math.min(bottom, otherBottom);
      if (verticalStart <= verticalEnd) {
        const y = boundedMidpoint(verticalStart, verticalEnd);
        if (right + 2 === otherLeft) {
          connectors.push({
            id: `${module.id}-${other.id}`,
            x: right + 1,
            y,
            fromModuleId: module.id,
            toModuleId: other.id,
            orientation: "horizontal",
          });
        } else if (otherRight + 2 === left) {
          connectors.push({
            id: `${other.id}-${module.id}`,
            x: otherRight + 1,
            y,
            fromModuleId: other.id,
            toModuleId: module.id,
            orientation: "horizontal",
          });
        }
      }

      const horizontalStart = Math.max(left, otherLeft);
      const horizontalEnd = Math.min(right, otherRight);
      if (horizontalStart <= horizontalEnd) {
        const x = boundedMidpoint(horizontalStart, horizontalEnd);
        if (bottom + 2 === otherTop) {
          connectors.push({
            id: `${module.id}-${other.id}`,
            x,
            y: bottom + 1,
            fromModuleId: module.id,
            toModuleId: other.id,
            orientation: "vertical",
          });
        } else if (otherBottom + 2 === top) {
          connectors.push({
            id: `${other.id}-${module.id}`,
            x,
            y: otherBottom + 1,
            fromModuleId: other.id,
            toModuleId: module.id,
            orientation: "vertical",
          });
        }
      }
    });
  });

  return connectors;
};

const doorCellsFor = (module: ModuleState, modules: ModuleState[]) => {
  const doors = touchingDoorCells(module, modules);
  if (module.type === "airlock") {
    const connected = doors[0] ?? fallbackDoorCell(module, modules);
    if (!connected) return [];
    const opposite: Record<CardinalSide, CardinalSide> = {
      north: "south",
      east: "west",
      south: "north",
      west: "east",
    };
    const connectedSide = connected.sides[0];
    const exteriorSide = opposite[connectedSide];
    const middleX = module.position.x + localMidpoint(module.position.width);
    const middleY = module.position.y + localMidpoint(module.position.height);
    const exteriorDoor: DoorCell = exteriorSide === "north"
      ? { x: middleX, y: module.position.y, sides: ["north"], connectedModuleIds: [] }
      : exteriorSide === "south"
        ? { x: middleX, y: module.position.y + module.position.height - 1, sides: ["south"], connectedModuleIds: [] }
        : exteriorSide === "west"
          ? { x: module.position.x, y: middleY, sides: ["west"], connectedModuleIds: [] }
          : { x: module.position.x + module.position.width - 1, y: middleY, sides: ["east"], connectedModuleIds: [] };
    return [connected, exteriorDoor];
  }
  if (doors.length > 0) return doors;
  const fallback = fallbackDoorCell(module, modules);
  return fallback ? [fallback] : [];
};

const partitionFor = (
  module: ModuleState,
  localX: number,
  localY: number,
): InteriorPartition | null => {
  if (module.type === "habitat" && module.position.width >= 5 && localX === 2) {
    if (localY === 1) return { side: "east" };
    if (localY === 2) return { side: "east", opening: true };
  }

  if (module.type === "laboratory" && module.position.width >= 5 && localX === 2) {
    if (localY === 1) return { side: "east" };
    if (localY === 2) return { side: "east", opening: true };
  }

  return null;
};

const fixturePlacementsFor = (module: ModuleState): FixturePlacement[] => {
  switch (module.type) {
    case "habitat":
      return [
        {
          id: "sleeping-bunk-a",
          kind: "bed",
          label: "crew bunk A",
          icon: "crew",
          x: 1,
          y: 1,
          width: 1,
          height: 2,
          segments: 2,
        },
        {
          id: "sleeping-bunk-b",
          kind: "bed",
          label: "crew bunk B",
          icon: "crew",
          x: 2,
          y: 1,
          width: 1,
          height: 2,
          segments: 2,
        },
        {
          id: "mess-table",
          kind: "mess-table",
          label: "mess table",
          icon: "food",
          x: 3,
          y: 3,
          width: Math.min(2, Math.max(1, module.position.width - 3)),
          height: 1,
          segments: 3,
        },
        {
          id: "habitat-console",
          kind: "hab-console",
          label: "habitat console",
          icon: "activity",
          x: Math.max(1, module.position.width - 2),
          y: Math.max(1, module.position.height - 2),
          width: 1,
          height: 1,
          segments: 2,
        },
      ];
    case "life_support":
      return [
        {
          id: "life-tanks",
          kind: "life-tanks",
          label: "oxygen and water tanks",
          icon: "oxygen",
          x: 1,
          y: 1,
          width: 2,
          height: 2,
          segments: 4,
        },
        {
          id: "scrubber",
          kind: "scrubber",
          label: "carbon scrubber",
          icon: "activity",
          x: Math.max(1, module.position.width - 2),
          y: 1,
          width: 1,
          height: 2,
          segments: 3,
        },
        {
          id: "life-console",
          kind: "life-console",
          label: "life support console",
          icon: "water",
          x: Math.max(1, module.position.width - 2),
          y: Math.max(1, module.position.height - 2),
          width: 1,
          height: 1,
          segments: 2,
        },
      ];
    case "laboratory":
      return [
        {
          id: "wet-bench",
          kind: "lab-bench",
          label: "laboratory wet bench",
          icon: "research",
          x: 1,
          y: 1,
          width: 2,
          height: 2,
          segments: 4,
        },
        {
          id: "microscope",
          kind: "microscope",
          label: "sample microscope",
          icon: "research",
          x: Math.max(1, module.position.width - 2),
          y: 1,
          width: 1,
          height: 1,
          segments: 2,
        },
        {
          id: "analysis-bench",
          kind: "analysis-bench",
          label: "analysis bench",
          icon: "work",
          x: 1,
          y: Math.max(1, module.position.height - 2),
          width: 2,
          height: 1,
          segments: 3,
        },
        {
          id: "lab-console",
          kind: "lab-console",
          label: "laboratory console",
          icon: "activity",
          x: Math.max(1, module.position.width - 2),
          y: Math.max(1, module.position.height - 2),
          width: 1,
          height: 1,
          segments: 2,
        },
      ];
    case "storage":
      return [
        {
          id: "storage-rack",
          kind: "storage-rack",
          label: "cargo storage rack",
          icon: "gear",
          x: 1,
          y: 1,
          width: Math.min(2, Math.max(1, module.position.width - 2)),
          height: Math.min(2, Math.max(1, module.position.height - 2)),
          segments: 4,
        },
      ];
    case "airlock":
      return [
        {
          id: "airlock-chamber",
          kind: "airlock-chamber",
          label: "pressure chamber",
          icon: "shield",
          x: 2,
          y: 2,
          width: 1,
          height: 2,
          segments: 2,
        },
        {
          id: "suit-rack",
          kind: "suit-rack",
          label: "EVA suit rack",
          icon: "crew",
          x: 1,
          y: 1,
          width: 1,
          height: 2,
          segments: 2,
        },
      ];
    case "solar_battery_skid":
      return [
        {
          id: "solar-bank-a",
          kind: "solar-bank",
          label: "solar panel bank A",
          icon: "power",
          x: 0,
          y: 0,
          width: Math.min(2, module.position.width),
          height: Math.min(2, module.position.height),
          segments: 8,
        },
        {
          id: "solar-bank-b",
          kind: "solar-bank",
          label: "solar panel bank B",
          icon: "power",
          x: Math.min(2, Math.max(0, module.position.width - 2)),
          y: Math.min(2, Math.max(0, module.position.height - 2)),
          width: Math.min(2, module.position.width),
          height: Math.min(2, module.position.height),
          segments: 8,
        },
        {
          id: "battery-bank",
          kind: "battery-bank",
          label: "battery bank",
          icon: "activity",
          x: Math.max(0, module.position.width - 1),
          y: 0,
          width: 1,
          height: module.position.height,
          segments: 4,
        },
      ];
    case "landing_pad":
      return [
        {
          id: "landing-target",
          kind: "landing-target",
          label: "landing target",
          icon: "map",
          x: Math.min(1, Math.max(0, module.position.width - 1)),
          y: Math.min(1, Math.max(0, module.position.height - 1)),
          width: Math.max(1, module.position.width - 2),
          height: Math.max(1, module.position.height - 2),
          segments: 4,
        },
      ];
    case "corridor":
    default:
      return [];
  }
};

const tileKindFor = (
  module: ModuleState,
  localX: number,
  localY: number,
  door: DoorCell | undefined,
): TileKind => {
  if (module.type === "landing_pad") return "landing-pad";
  if (module.type === "solar_battery_skid") return "solar";
  if (door) return "door";
  if (module.type === "corridor") {
    const middleRow = localMidpoint(module.position.height);
    return localY === middleRow && localX > 0 && localX < module.position.width - 1
      ? "corridor"
      : "wall";
  }

  const perimeter =
    localX === 0 ||
    localY === 0 ||
    localX === module.position.width - 1 ||
    localY === module.position.height - 1;
  return perimeter ? "wall" : "floor";
};

const wallSidesFor = (module: ModuleState, localX: number, localY: number): CardinalSide[] => {
  const sides: CardinalSide[] = [];
  if (localY === 0) sides.push("north");
  if (localX === module.position.width - 1) sides.push("east");
  if (localY === module.position.height - 1) sides.push("south");
  if (localX === 0) sides.push("west");
  return sides;
};

const fixtureStyle = (module: ModuleState, fixture: FixturePlacement): CSSProperties => ({
  gridColumn: `${module.position.x + fixture.x + 1} / span ${fixture.width}`,
  gridRow: `${module.position.y + fixture.y + 1} / span ${fixture.height}`,
  zIndex: 3,
});

/**
 * Purely visual, cell-addressed module shell and furniture. Interaction remains on
 * MoonbaseMap's module button so fixtures never create nested focus targets.
 */
export function ModuleTilemap({ module, modules, selected, planned, ghost = false }: ModuleTilemapProps) {
  const doors = doorCellsFor(module, modules);
  const doorByCell = new Map(doors.map((door) => [cellKey(door.x, door.y), door]));
  const fixtures = fixturePlacementsFor(module);
  const breachLocal = {
    x: Math.max(0, module.position.width - 1),
    y: Math.max(0, Math.min(module.position.height - 1, Math.floor(module.position.height * 0.65))),
  };

  const tiles = [];
  for (let localY = 0; localY < module.position.height; localY += 1) {
    for (let localX = 0; localX < module.position.width; localX += 1) {
      const globalX = module.position.x + localX;
      const globalY = module.position.y + localY;
      const door = doorByCell.get(cellKey(globalX, globalY));
      const kind = tileKindFor(module, localX, localY, door);
      const wallSides = wallSidesFor(module, localX, localY);
      const partition = partitionFor(module, localX, localY);
      const breached = Boolean(
        module.breached && localX === breachLocal.x && localY === breachLocal.y,
      );
      const tileClass = [
        "module-tile",
        `tile-${kind}`,
        `tile-module-${module.type}`,
        ...wallSides.map((side) => `tile-edge-${side}`),
        ...(door?.sides.map((side) => `tile-door-${side}`) ?? []),
        partition ? `tile-partition-${partition.side}` : "",
        partition?.opening ? "tile-partition-opening" : "",
        module.atmosphere === "yes" ? "tile-pressurized" : "tile-vacuum",
        selected ? "tile-selected" : "",
        planned ? "tile-planned" : "",
        ghost ? "tile-ghost" : "",
        breached ? "tile-breached" : "",
      ]
        .filter(Boolean)
        .join(" ");

      tiles.push(
        <span
          aria-hidden="true"
          className={tileClass}
          data-connected-module-ids={door?.connectedModuleIds.join(" ") || undefined}
          data-door-side={door?.sides.join(" ") || undefined}
          data-grid-x={globalX}
          data-grid-y={globalY}
          data-local-x={localX}
          data-local-y={localY}
          data-module-id={module.id}
          data-partition={partition?.side}
          data-tile-kind={kind}
          key={`${module.id}-tile-${localX}-${localY}`}
          style={{
            gridColumn: `${globalX + 1}`,
            gridRow: `${globalY + 1}`,
            zIndex: 2,
          }}
        >
          <span className="tile-surface" />
          {(kind === "wall" || kind === "corridor") && <span className="tile-wall-cap" />}
          {kind === "door" && (
            <span className="tile-door-frame">
              <i className="tile-door-leaf leaf-a" />
              <i className="tile-door-leaf leaf-b" />
              <i className="tile-door-threshold" />
            </span>
          )}
          {partition && (
            <span
              className={`tile-interior-partition${partition.opening ? " has-opening" : ""}`}
            />
          )}
          {breached && (
            <span className="tile-breach-tear">
              <i />
              <i />
              <i />
            </span>
          )}
          {kind === "landing-pad" && <span className="tile-pad-marking" />}
          {kind === "solar" && <span className="tile-service-rail" />}
        </span>,
      );
    }
  }

  return (
    <div
      aria-hidden="true"
      className={`module-tile-group module-tile-group-${module.type}`}
      data-module-id={module.id}
      style={{ display: "contents" }}
    >
      {tiles}
      {fixtures.map((fixture) => (
        <span
          className={`tile-fixture fixture-${fixture.kind}${ghost ? " fixture-ghost" : ""}`}
          data-fixture={fixture.kind}
          data-fixture-id={`${module.id}-${fixture.id}`}
          data-module-id={module.id}
          key={`${module.id}-${fixture.id}`}
          style={fixtureStyle(module, fixture)}
          title={fixture.label}
        >
          <span className="fixture-shadow" />
          <span className="fixture-body">
            <GameIcon name={fixture.icon} size={13} />
            <span className="fixture-segments">
              {Array.from({ length: fixture.segments }, (_, index) => (
                <i className="fixture-segment" key={index} />
              ))}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

/** One-cell pressure links bridge the deliberate one-cell gaps in the seed layout. */
export function ModuleConnectors({ modules }: { modules: ModuleState[] }) {
  return connectorCellsFor(modules).map((connector) => (
    <span
      aria-hidden="true"
      className={`module-connector connector-tile connector-${connector.orientation} tile-pressurized`}
      data-connects-from={connector.fromModuleId}
      data-connects-to={connector.toModuleId}
      data-grid-x={connector.x}
      data-grid-y={connector.y}
      key={connector.id}
      style={{
        gridColumn: `${connector.x + 1}`,
        gridRow: `${connector.y + 1}`,
        zIndex: 2,
      }}
    >
      <span className="connector-floor" />
      <i className="connector-wall wall-a" />
      <i className="connector-wall wall-b" />
      <i className="connector-door-seam" />
    </span>
  ));
}
