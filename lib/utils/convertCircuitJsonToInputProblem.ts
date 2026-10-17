import type { InputProblem } from "lib/types/InputProblem"

type FacingDirection = "x+" | "x-" | "y+" | "y-"

const SCHEMATIC_RAIL_NET_LABEL_HEIGHT = 0.42
const getSchematicNetLabelTextWidth = (text: string) =>
  text.length * 0.12 + 0.12

interface CircuitJsonElement {
  type?: string
  [key: string]: any
}

export interface ConvertCircuitJsonOptions {
  sheetId?: string
}

export function isCircuitJsonArray(
  value: unknown,
): value is CircuitJsonElement[] {
  return (
    Array.isArray(value) &&
    value.some(
      (el) =>
        el &&
        typeof el === "object" &&
        (el.type === "schematic_component" || el.type === "schematic_port"),
    )
  )
}

export function convertCircuitJsonToInputProblem(
  elements: CircuitJsonElement[],
  options: ConvertCircuitJsonOptions = {},
): InputProblem {
  const allSchematicComponents = elements.filter(
    (el) => el.type === "schematic_component",
  )

  const targetSheetId =
    options.sheetId ??
    allSchematicComponents.find((c) => typeof c.schematic_sheet_id === "string")
      ?.schematic_sheet_id

  const schematicComponents = allSchematicComponents.filter(
    (el) =>
      targetSheetId === undefined || el.schematic_sheet_id === targetSheetId,
  )

  const compIds = new Set(
    schematicComponents.map((c) => c.schematic_component_id),
  )
  const schematicPorts = elements.filter(
    (el) =>
      el.type === "schematic_port" && compIds.has(el.schematic_component_id),
  )
  const sourcePortById = new Map(
    elements
      .filter((el) => el.type === "source_port")
      .map((p) => [p.source_port_id, p]),
  )

  const facingMap: Record<string, FacingDirection> = {
    left: "x-",
    right: "x+",
    up: "y+",
    down: "y-",
  }

  const chips = schematicComponents.map((schComp) => {
    const pins = schematicPorts
      .filter(
        (p) => p.schematic_component_id === schComp.schematic_component_id,
      )
      .sort((a, b) => (a.pin_number ?? 0) - (b.pin_number ?? 0))
      .map((port) => {
        const sp = sourcePortById.get(port.source_port_id)
        const displayName =
          port.display_pin_label ?? port.pin_number?.toString() ?? sp?.name
        return {
          pinId: port.schematic_port_id,
          ...(displayName ? { displayName } : {}),
          x: port.center.x,
          y: port.center.y,
          ...(port.facing_direction && facingMap[port.facing_direction]
            ? { _facingDirection: facingMap[port.facing_direction] }
            : {}),
        }
      })

    let minX = schComp.center.x - schComp.size.width / 2
    let maxX = schComp.center.x + schComp.size.width / 2
    let minY = schComp.center.y - schComp.size.height / 2
    let maxY = schComp.center.y + schComp.size.height / 2
    for (const pin of pins) {
      minX = Math.min(minX, pin.x)
      maxX = Math.max(maxX, pin.x)
      minY = Math.min(minY, pin.y)
      maxY = Math.max(maxY, pin.y)
    }

    return {
      chipId: schComp.schematic_component_id,
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      width: maxX - minX,
      height: maxY - minY,
      pins,
    }
  })

  const textBoxes = elements
    .filter(
      (el) =>
        el.type === "schematic_text" &&
        compIds.has(el.schematic_component_id) &&
        typeof el.text === "string" &&
        el.text.trim().length > 0,
    )
    .map((st) => {
      const fontSize = st.font_size ?? 0.18
      const width = st.text.length * 0.105 * (fontSize / 0.18)
      const height = fontSize
      return {
        chipId: st.schematic_component_id,
        center: { x: st.position.x, y: st.position.y },
        width,
        height,
        text: st.text,
      }
    })

  const schPortIdBySourcePortId = new Map<string, string>()
  for (const sp of schematicPorts) {
    if (sp.source_port_id) {
      schPortIdBySourcePortId.set(sp.source_port_id, sp.schematic_port_id)
    }
  }

  const sourceTraces = elements.filter((el) => el.type === "source_trace")
  const sourceNets = elements.filter((el) => el.type === "source_net")
  const netById = new Map(sourceNets.map((n) => [n.source_net_id, n]))

  const directConnections: InputProblem["directConnections"] = []
  const netPinMap = new Map<string, Set<string>>()

  for (const st of sourceTraces) {
    const portIds: string[] = (st.connected_source_port_ids ?? [])
      .map((spId: string) => schPortIdBySourcePortId.get(spId))
      .filter((id: string | undefined): id is string => Boolean(id))
    const netIds: string[] = st.connected_source_net_ids ?? []

    if (netIds.length > 0) {
      for (const netId of netIds) {
        const net = netById.get(netId)
        if (!net) continue
        if (!netPinMap.has(net.name)) netPinMap.set(net.name, new Set())
        for (const pid of portIds) {
          netPinMap.get(net.name)!.add(pid)
        }
      }
    } else if (portIds.length >= 2) {
      for (let i = 0; i < portIds.length - 1; i++) {
        directConnections.push({
          pinIds: [portIds[i]!, portIds[i + 1]!],
          ...(st.display_name
            ? {
                netId: st.display_name,
                netLabelWidth: getSchematicNetLabelTextWidth(st.display_name),
              }
            : {}),
        })
      }
    }
  }

  const netConnections: InputProblem["netConnections"] = []
  const availableNetLabelOrientations: Record<string, FacingDirection[]> = {}

  for (const [netName, pinSet] of netPinMap.entries()) {
    const pinIds = Array.from(pinSet)
    if (pinIds.length === 0) continue
    const net = sourceNets.find((n) => n.name === netName)
    const isGround = Boolean(net?.is_ground)
    const isPower = Boolean(net?.is_power)
    const isRail = isGround || isPower
    const textWidth = getSchematicNetLabelTextWidth(netName)

    netConnections.push({
      netId: netName,
      isGround,
      netLabelWidth: isRail ? SCHEMATIC_RAIL_NET_LABEL_HEIGHT : textWidth,
      ...(isRail ? { netLabelHeight: textWidth } : {}),
      pinIds,
    })

    if (isGround) {
      availableNetLabelOrientations[netName] = ["y-"]
    } else if (isPower) {
      availableNetLabelOrientations[netName] = ["y+"]
    } else {
      availableNetLabelOrientations[netName] = ["x-", "x+"]
    }
  }

  return {
    chips,
    directConnections,
    netConnections,
    textBoxes,
    availableNetLabelOrientations,
    maxMspPairDistance: 2.4,
  }
}
