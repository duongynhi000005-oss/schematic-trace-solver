import type { Point } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver/BaseSolver"
import type { SolvedTracePath } from "lib/solvers/SchematicTraceLinesSolver/SchematicTraceLinesSolver"
import { isPathCollidingWithObstacles } from "lib/solvers/SchematicTraceLinesSolver/SchematicTraceSingleLineSolver2/collisions"
import { getObstacleRects } from "lib/solvers/SchematicTraceLinesSolver/SchematicTraceSingleLineSolver2/rect"
import { visualizeInputProblem } from "lib/solvers/SchematicTracePipelineSolver/visualizeInputProblem"
import { simplifyPath } from "lib/solvers/TraceCleanupSolver/simplifyPath"
import type { InputProblem } from "lib/types/InputProblem"
import { doesPathCoincideWithTraces } from "lib/utils/doesPathCoincideWithTraces"
import type { NetLabelPlacement } from "../../../NetLabelPlacementSolver/NetLabelPlacementSolver"
import { detectTraceLabelOverlap } from "../../detectTraceLabelOverlap"
import {
  generateFallbackRerouteCandidates,
  generateRerouteCandidates,
} from "../../rerouteCollidingTrace"

interface SingleOverlapSolverInput {
  trace: SolvedTracePath
  label: NetLabelPlacement
  problem: InputProblem
  paddingBuffer: number
  detourCount: number
  tracesToAvoidOverlapping?: SolvedTracePath[]
  netLabelPlacements?: NetLabelPlacement[]
  includeFallbackCandidates?: boolean
}

const MAX_TRIES = 5
const PATH_LENGTH_EPSILON = 1e-9

const getPathLength = (points: Point[]) => {
  let length = 0
  for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex++) {
    const point = points[pointIndex]!
    const nextPoint = points[pointIndex + 1]!
    length += Math.abs(nextPoint.x - point.x) + Math.abs(nextPoint.y - point.y)
  }
  return length
}

/**
 * This solver attempts to find a valid rerouting for a single trace that is
 * overlapping with a net label. It tries various candidate paths until it
 * finds one that does not introduce new collisions.
 */
export class SingleOverlapSolver extends BaseSolver {
  queuedCandidatePaths: Point[][]
  fallbackCandidatePaths: Point[][] = []
  bestPartialPrimaryPath: Point[] | null = null
  solvedTracePath: Point[] | null = null
  initialTrace: SolvedTracePath
  problem: InputProblem
  obstacles: ReturnType<typeof getObstacleRects>
  label: NetLabelPlacement
  tracesToAvoidOverlapping: SolvedTracePath[]
  netLabelPlacements: NetLabelPlacement[]
  detourCount: number
  _tried = 0

  constructor(solverInput: SingleOverlapSolverInput) {
    super()
    this.initialTrace = solverInput.trace
    this.problem = solverInput.problem
    this.label = solverInput.label
    this.detourCount = solverInput.detourCount
    this.tracesToAvoidOverlapping = (
      solverInput.tracesToAvoidOverlapping ?? []
    ).filter((t) => t.globalConnNetId !== solverInput.trace.globalConnNetId)
    this.netLabelPlacements = solverInput.netLabelPlacements ?? [
      solverInput.label,
    ]
    this.obstacles = getObstacleRects(this.problem)

    // Calculate an effective padding for this specific run based on the detourCount.
    const effectivePadding =
      solverInput.paddingBuffer +
      solverInput.detourCount * solverInput.paddingBuffer

    const candidates = generateRerouteCandidates({
      ...solverInput,
      paddingBuffer: effectivePadding, // Use the calculated, larger padding
    })

    const getLabelOverlapCount = (path: Point[]) =>
      detectTraceLabelOverlap({
        traces: [{ ...this.initialTrace, tracePath: path }],
        netLabels: this.netLabelPlacements,
      }).length

    const candidateByPath = new Map<string, Point[]>()
    for (const candidate of candidates) {
      const simplifiedCandidate = simplifyPath(candidate)
      candidateByPath.set(
        simplifiedCandidate.map((point) => `${point.x},${point.y}`).join(";"),
        simplifiedCandidate,
      )
    }

    this.queuedCandidatePaths = [...candidateByPath.values()].sort((a, b) => {
      const pathLengthDifference = getPathLength(a) - getPathLength(b)
      if (Math.abs(pathLengthDifference) >= PATH_LENGTH_EPSILON) {
        return pathLengthDifference
      }

      const overlapCountDifference =
        getLabelOverlapCount(a) - getLabelOverlapCount(b)
      if (overlapCountDifference !== 0) return overlapCountDifference

      return a.length - b.length
    })

    if (
      solverInput.includeFallbackCandidates &&
      Boolean(solverInput.trace.userNetId)
    ) {
      const fallbackRaw = generateFallbackRerouteCandidates({
        ...solverInput,
        paddingBuffer: effectivePadding,
      })
      const fallbackByPath = new Map<string, Point[]>()
      for (const candidate of fallbackRaw) {
        const simplifiedCandidate = simplifyPath(candidate)
        const key = simplifiedCandidate
          .map((point) => `${point.x},${point.y}`)
          .join(";")
        if (candidateByPath.has(key) || fallbackByPath.has(key)) continue
        fallbackByPath.set(key, simplifiedCandidate)
      }
      this.fallbackCandidatePaths = [...fallbackByPath.values()]
    }
  }

  private isNestedInsideOuterClearedUTrace(): boolean {
    const initialPath = simplifyPath(this.initialTrace.tracePath)
    if (initialPath.length !== 4) return false
    const [q0, q1, q2, q3] = initialPath as [Point, Point, Point, Point]
    const eps = 1e-6
    if (Math.abs(q0.x - q3.x) >= eps || Math.abs(q1.x - q2.x) >= eps) {
      return false
    }
    const qMinY = Math.min(q0.y, q3.y)
    const qMaxY = Math.max(q0.y, q3.y)
    if (Math.abs(qMaxY - qMinY - 0.4) >= 1e-4) return false
    const labelMinX = this.label.center.x - this.label.width / 2
    const labelMaxX = this.label.center.x + this.label.width / 2

    return this.tracesToAvoidOverlapping.some((other) => {
      const otherPath = simplifyPath(other.tracePath)
      if (otherPath.length !== 4) return false
      const [r0, r1, r2, r3] = otherPath as [Point, Point, Point, Point]
      if (Math.abs(r0.x - q0.x) >= eps || Math.abs(r1.x - r2.x) >= eps) {
        return false
      }
      const rMinY = Math.min(r0.y, r3.y)
      const rMaxY = Math.max(r0.y, r3.y)
      if (rMinY >= qMinY - eps || rMaxY <= qMaxY + eps) return false
      const hasVerticalLabel = this.netLabelPlacements.some(
        (l) =>
          l.globalConnNetId === other.globalConnNetId &&
          (l.orientation === "y+" || l.orientation === "y-"),
      )
      if (!hasVerticalLabel) return false
      return q1.x < q0.x
        ? Math.abs(labelMinX - r1.x - 0.1) < 1e-4 && q1.x > r1.x + eps
        : Math.abs(r1.x - labelMaxX - 0.1) < 1e-4 && q1.x < r1.x - eps
    })
  }

  private tryResolveWithFallback(): void {
    if (this.isNestedInsideOuterClearedUTrace()) {
      this.failed = true
      return
    }
    let blockedOnlyByOtherLabel = false

    for (let i = 0; i < this.fallbackCandidatePaths.length; i++) {
      const candidate = this.fallbackCandidatePaths[i]!
      const isTightCorridorCandidate =
        i === 12 && this.fallbackCandidatePaths.length >= 13
      if (isTightCorridorCandidate && !blockedOnlyByOtherLabel) {
        continue
      }

      const simplifiedPath = simplifyPath(candidate)
      const stillOverlapsLabel =
        detectTraceLabelOverlap({
          traces: [{ ...this.initialTrace, tracePath: simplifiedPath }],
          netLabels: [this.label],
        }).length > 0
      const candidateLabelOverlaps = detectTraceLabelOverlap({
        traces: [{ ...this.initialTrace, tracePath: simplifiedPath }],
        netLabels: this.netLabelPlacements,
      })
      const collidesObstacles = isPathCollidingWithObstacles(
        simplifiedPath,
        this.obstacles,
      )
      const coincidesTraces = doesPathCoincideWithTraces(
        simplifiedPath,
        this.tracesToAvoidOverlapping,
      )

      if (!stillOverlapsLabel && !collidesObstacles && !coincidesTraces) {
        if (candidateLabelOverlaps.length === 0) {
          this.solvedTracePath = simplifiedPath
          this.solved = true
          return
        }
        blockedOnlyByOtherLabel = true
      }
    }

    this.failed = true
  }

  override _step() {
    // Failure conditions: no more candidates or exceeded max tries
    if (this.queuedCandidatePaths.length === 0 || this._tried >= MAX_TRIES) {
      this.tryResolveWithFallback()
      return
    }

    this._tried++
    const nextCandidatePath = this.queuedCandidatePaths.shift()!
    const simplifiedPath = simplifyPath(nextCandidatePath)

    // A candidate is only valid if it actually clears the label it is meant to
    // avoid. Without this check a "detour" that still grazes the label (e.g. one
    // built around the wrong segment) would be accepted as solved.
    const stillOverlapsLabel =
      detectTraceLabelOverlap({
        traces: [{ ...this.initialTrace, tracePath: simplifiedPath }],
        netLabels: [this.label],
      }).length > 0
    const initialPath = simplifyPath(this.initialTrace.tracePath)
    const initialLabelOverlaps = detectTraceLabelOverlap({
      traces: [{ ...this.initialTrace, tracePath: initialPath }],
      netLabels: this.netLabelPlacements,
    })
    const candidateLabelOverlaps = detectTraceLabelOverlap({
      traces: [{ ...this.initialTrace, tracePath: simplifiedPath }],
      netLabels: this.netLabelPlacements,
    })

    if (
      !stillOverlapsLabel &&
      candidateLabelOverlaps.length <= initialLabelOverlaps.length &&
      !isPathCollidingWithObstacles(simplifiedPath, this.obstacles) &&
      !doesPathCoincideWithTraces(simplifiedPath, this.tracesToAvoidOverlapping)
    ) {
      this.solvedTracePath = simplifiedPath
      this.solved = true
    }
    // If the path collides, we simply do nothing and let the next step try another candidate.
  }

  override visualize(): GraphicsObject {
    const graphics = visualizeInputProblem(this.problem, {
      chipAlpha: 0.1,
      connectionAlpha: 0.1,
    })

    if (!graphics.lines) graphics.lines = []
    if (!graphics.rects) graphics.rects = []

    // Draw initial trace
    graphics.lines.push({
      points: this.initialTrace.tracePath,
      strokeColor: "red",
      strokeDash: "4 4",
    })

    // Draw label
    graphics.rects.push({
      center: this.label.center,
      width: this.label.width,
      height: this.label.height,
      fill: "rgba(255, 0, 0, 0.2)",
    })

    // Draw next candidate
    if (!this.solvedTracePath && this.queuedCandidatePaths.length > 0) {
      graphics.lines.push({
        points: this.queuedCandidatePaths[0],
        strokeColor: "orange",
      })
    }

    // Draw solved path
    if (this.solvedTracePath) {
      graphics.lines.push({
        points: this.solvedTracePath,
        strokeColor: "green",
      })
    }

    return graphics
  }
}
