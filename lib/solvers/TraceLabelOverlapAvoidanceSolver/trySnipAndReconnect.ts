import type { Point } from "@tscircuit/math-utils"
import type { SolvedTracePath } from "../SchematicTraceLinesSolver/SchematicTraceLinesSolver"

export const generateSnipAndReconnectCandidates = ({
  initialTrace,
  firstInsideIndex,
  lastInsideIndex,
  labelBounds,
  paddingBuffer,
  detourCount,
}: {
  initialTrace: SolvedTracePath
  firstInsideIndex: number
  lastInsideIndex: number
  labelBounds: any
  paddingBuffer: number
  detourCount: number
}): Point[][] => {
  if (
    firstInsideIndex <= 0 ||
    lastInsideIndex >= initialTrace.tracePath.length - 1
  ) {
    return []
  }

  const entryPoint = initialTrace.tracePath[firstInsideIndex - 1]
  const exitPoint = initialTrace.tracePath[lastInsideIndex + 1]

  const pathToEntry = initialTrace.tracePath.slice(0, firstInsideIndex)
  const pathFromExit = initialTrace.tracePath.slice(lastInsideIndex + 1)

  const allCandidateDetours: Point[][] = []

  // Candidate type 1: simple elbow
  if (entryPoint.x !== exitPoint.x && entryPoint.y !== exitPoint.y) {
    allCandidateDetours.push([{ x: exitPoint.x, y: entryPoint.y }])
    allCandidateDetours.push([{ x: entryPoint.x, y: exitPoint.y }])
  } else if (entryPoint.x === exitPoint.x || entryPoint.y === exitPoint.y) {
    // Candidate type 2: direct connection (if points are aligned)
    allCandidateDetours.push([]) // No detour points needed
  }

  // Candidate type 3: routing around the label bounds
  const buffer = paddingBuffer + detourCount * paddingBuffer
  const leftX = labelBounds.minX - buffer
  const rightX = labelBounds.maxX + buffer
  const topY = labelBounds.maxY + buffer
  const bottomY = labelBounds.minY - buffer

  if (
    (entryPoint.x <= labelBounds.minX || exitPoint.x <= labelBounds.minX) &&
    entryPoint.x < labelBounds.maxX &&
    exitPoint.x < labelBounds.maxX
  ) {
    allCandidateDetours.push([
      { x: leftX, y: entryPoint.y },
      { x: leftX, y: exitPoint.y },
    ])
  }

  if (
    (entryPoint.x >= labelBounds.maxX || exitPoint.x >= labelBounds.maxX) &&
    entryPoint.x > labelBounds.minX &&
    exitPoint.x > labelBounds.minX
  ) {
    allCandidateDetours.push([
      { x: rightX, y: entryPoint.y },
      { x: rightX, y: exitPoint.y },
    ])
  }

  if (
    (entryPoint.y >= labelBounds.maxY || exitPoint.y >= labelBounds.maxY) &&
    entryPoint.y > labelBounds.minY &&
    exitPoint.y > labelBounds.minY
  ) {
    allCandidateDetours.push([
      { x: entryPoint.x, y: topY },
      { x: exitPoint.x, y: topY },
    ])
  }

  if (
    (entryPoint.y <= labelBounds.minY || exitPoint.y <= labelBounds.minY) &&
    entryPoint.y < labelBounds.maxY &&
    exitPoint.y < labelBounds.maxY
  ) {
    allCandidateDetours.push([
      { x: entryPoint.x, y: bottomY },
      { x: exitPoint.x, y: bottomY },
    ])
  }

  return allCandidateDetours.map((detour) => [
    ...pathToEntry,
    ...detour,
    ...pathFromExit,
  ])
}

export const generateFallbackSnipAndReconnectCandidates = ({
  initialTrace,
  labelBounds,
  paddingBuffer,
  detourCount,
}: {
  initialTrace: SolvedTracePath
  firstInsideIndex: number
  lastInsideIndex: number
  labelBounds: any
  paddingBuffer: number
  detourCount: number
}): Point[][] => {
  const path = initialTrace.tracePath
  if (path.length !== 4) {
    return []
  }

  const [p0, p1, p2, p3] = path as [Point, Point, Point, Point]
  const eps = 1e-6
  const baseBuffer = paddingBuffer + detourCount * paddingBuffer
  const candidates: Point[][] = []

  const steps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0.5]

  // Vertical U-trace connecting two pins on the same vertical line (p0.x === p3.x)
  if (
    Math.abs(p0.x - p3.x) < eps &&
    Math.abs(p1.x - p2.x) < eps &&
    Math.abs(p0.y - p1.y) < eps &&
    Math.abs(p2.y - p3.y) < eps
  ) {
    const dx = p1.x - p0.x
    if (Math.abs(dx) > eps) {
      const getOuterX = (step: number) =>
        dx > 0
          ? Math.max(p1.x, labelBounds.maxX + baseBuffer * step)
          : Math.min(p1.x, labelBounds.minX - baseBuffer * step)

      for (const step of steps) {
        const outerX = getOuterX(step)
        candidates.push([
          p0,
          { x: outerX, y: p0.y },
          { x: outerX, y: p3.y },
          p3,
        ])
      }

      if (detourCount === 0 && Math.abs(dx) <= 0.1 + eps) {
        const minPinY = Math.min(p0.y, p3.y)
        const maxPinY = Math.max(p0.y, p3.y)
        const altMinY = Math.min(minPinY, labelBounds.minY) - baseBuffer * 0.5
        const altMaxY = Math.max(maxPinY, labelBounds.maxY) + baseBuffer * 0.5
        const innerMinY = labelBounds.minY - baseBuffer * 0.5
        const innerMaxY = labelBounds.maxY + baseBuffer * 0.5
        const yPairs: Array<[number, number]> = [
          [p0.y < p3.y ? innerMinY : p0.y, p3.y < p0.y ? innerMinY : p3.y],
          [p0.y > p3.y ? innerMaxY : p0.y, p3.y > p0.y ? innerMaxY : p3.y],
          [p0.y < p3.y ? altMinY : p0.y, p3.y < p0.y ? altMinY : p3.y],
          [p0.y > p3.y ? altMaxY : p0.y, p3.y > p0.y ? altMaxY : p3.y],
        ]
        for (const [y0, y3] of yPairs) {
          for (const step of steps) {
            const outerX = getOuterX(step)
            candidates.push([
              p0,
              p1,
              { x: p1.x, y: y0 },
              { x: outerX, y: y0 },
              { x: outerX, y: y3 },
              { x: p2.x, y: y3 },
              p2,
              p3,
            ])
          }
        }
      }
    }
    return candidates
  }

  // Horizontal U-trace connecting two pins on the same horizontal line (p0.y === p3.y)
  if (
    Math.abs(p0.y - p3.y) < eps &&
    Math.abs(p1.y - p2.y) < eps &&
    Math.abs(p0.x - p1.x) < eps &&
    Math.abs(p2.x - p3.x) < eps
  ) {
    const dy = p1.y - p0.y
    if (Math.abs(dy) > eps) {
      const getOuterY = (step: number) =>
        dy > 0
          ? Math.max(p1.y, labelBounds.maxY + baseBuffer * step)
          : Math.min(p1.y, labelBounds.minY - baseBuffer * step)

      for (const step of steps) {
        const outerY = getOuterY(step)
        candidates.push([
          p0,
          { x: p0.x, y: outerY },
          { x: p3.x, y: outerY },
          p3,
        ])
      }

      if (detourCount === 0 && Math.abs(dy) <= 0.1 + eps) {
        const minPinX = Math.min(p0.x, p3.x)
        const maxPinX = Math.max(p0.x, p3.x)
        const altMinX = Math.min(minPinX, labelBounds.minX) - baseBuffer * 0.5
        const altMaxX = Math.max(maxPinX, labelBounds.maxX) + baseBuffer * 0.5
        const innerMinX = labelBounds.minX - baseBuffer * 0.5
        const innerMaxX = labelBounds.maxX + baseBuffer * 0.5
        const xPairs: Array<[number, number]> = [
          [p0.x < p3.x ? innerMinX : p0.x, p3.x < p0.x ? innerMinX : p3.x],
          [p0.x > p3.x ? innerMaxX : p0.x, p3.x > p0.x ? innerMaxX : p3.x],
          [p0.x < p3.x ? altMinX : p0.x, p3.x < p0.x ? altMinX : p3.x],
          [p0.x > p3.x ? altMaxX : p0.x, p3.x > p0.x ? altMaxX : p3.x],
        ]
        for (const [x0, x3] of xPairs) {
          for (const step of steps) {
            const outerY = getOuterY(step)
            candidates.push([
              p0,
              p1,
              { x: x0, y: p1.y },
              { x: x0, y: outerY },
              { x: x3, y: outerY },
              { x: x3, y: p2.y },
              p2,
              p3,
            ])
          }
        }
      }
    }
    return candidates
  }

  return []
}
