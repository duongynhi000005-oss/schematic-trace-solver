import { expect, test } from "bun:test"
import { SchematicTracePipelineSolver } from "lib/solvers/SchematicTracePipelineSolver/SchematicTracePipelineSolver"
import type { InputProblem } from "lib/types/InputProblem"
import {
  convertCircuitJsonToInputProblem,
  isCircuitJsonArray,
} from "lib/utils/convertCircuitJsonToInputProblem"
import { pathIntersectsRenderedLabel } from "lib/utils/pathIntersectsRenderedLabel"
import issue1300Problem from "./assets/issue1300-audio.input.json"
import issue1301Problem from "./assets/issue1301-mcu.input.json"
import issue1326Sheets from "./assets/issue1326-smartknob.input.json"

const getRenderedLabelCollisions = (solver: SchematicTracePipelineSolver) => {
  const output = solver.netLabelToTraceSolver?.getOutput()
  const traces = output?.traces ?? []
  const labels = output?.netLabelPlacements ?? []

  const collisions: Array<{ traceId: string; netId?: string }> = []
  for (const trace of traces) {
    for (const label of labels) {
      if (
        pathIntersectsRenderedLabel(trace.tracePath, {
          ...label,
          width: label.width - 0.002,
          height: label.height - 0.002,
        })
      ) {
        collisions.push({ traceId: trace.mspPairId, netId: label.netId })
      }
    }
  }
  return collisions
}

test("issue #1300: expands same-side U-traces clear of wide net labels on audio sheet", () => {
  const inputProblem: InputProblem = JSON.parse(
    JSON.stringify(issue1300Problem),
  )
  const solver = new SchematicTracePipelineSolver(inputProblem)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(getRenderedLabelCollisions(solver)).toEqual([])
})

test("issue #1301: expands U-traces and snaps same-net horizontal labels clear of extended segments on MCU sheet", () => {
  const inputProblem: InputProblem = JSON.parse(
    JSON.stringify(issue1301Problem),
  )
  const solver = new SchematicTracePipelineSolver(inputProblem)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(getRenderedLabelCollisions(solver)).toEqual([])
})

test("issue #1326: resolves U-trace and same-net rail label collisions across SmartKnob sheets", () => {
  for (const [, sheetProblem] of Object.entries(issue1326Sheets)) {
    const inputProblem: InputProblem = JSON.parse(JSON.stringify(sheetProblem))
    const solver = new SchematicTracePipelineSolver(inputProblem)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(getRenderedLabelCollisions(solver)).toEqual([])
  }
})

test("converts Circuit JSON array attachments into valid InputProblem objects", () => {
  const circuitJson = [
    {
      type: "schematic_component",
      schematic_component_id: "schematic_component_0",
      schematic_sheet_id: "schematic_sheet_0",
      center: { x: 0, y: 0 },
      size: { width: 2, height: 2 },
    },
    {
      type: "source_port",
      source_port_id: "source_port_0",
      name: "P1",
    },
    {
      type: "source_port",
      source_port_id: "source_port_1",
      name: "P2",
    },
    {
      type: "schematic_port",
      schematic_port_id: "schematic_port_0",
      schematic_component_id: "schematic_component_0",
      source_port_id: "source_port_0",
      pin_number: 1,
      center: { x: -1, y: 0.5 },
      facing_direction: "left",
    },
    {
      type: "schematic_port",
      schematic_port_id: "schematic_port_1",
      schematic_component_id: "schematic_component_0",
      source_port_id: "source_port_1",
      pin_number: 2,
      center: { x: -1, y: -0.5 },
      facing_direction: "left",
    },
    {
      type: "source_net",
      source_net_id: "source_net_0",
      name: "GND",
      is_ground: true,
    },
    {
      type: "source_trace",
      source_trace_id: "source_trace_0",
      connected_source_port_ids: ["source_port_0", "source_port_1"],
      connected_source_net_ids: ["source_net_0"],
    },
  ]

  expect(isCircuitJsonArray(circuitJson)).toBe(true)
  const problem = convertCircuitJsonToInputProblem(circuitJson)
  expect(problem.chips).toHaveLength(1)
  expect(problem.chips[0]?.pins).toHaveLength(2)
  expect(problem.netConnections).toHaveLength(1)
  expect(problem.netConnections[0]?.netId).toBe("GND")
  expect(problem.availableNetLabelOrientations["GND"]).toEqual(["y-"])
})
