import { sameCell, type Cell } from "@/shared/grid";
import type { Level } from "@/shared/world";
import type { Guard } from "@/features/patrol";
import type {
  AnalysisResult, CaptureInfo, Combo, Divergence, Evidence, GuardReport, PairFinding, RecordedTurn, Residual
} from "./types";
import { replayScript, type ReplayFrame } from "./replay";

const WINDOW = 4;

function windowTurns(captureTurn: number): number[] {
  return Array.from({ length: WINDOW }, (_, index) => captureTurn - (WINDOW - 1) + index);
}

function pointsAt(frames: readonly ReplayFrame[], guardId: string, turn: number): number {
  const frame = frames.find((candidate) => candidate.turn === turn);
  return frame?.readings.find((candidate) => candidate.id === guardId)?.points ?? 0;
}

/** The guard's real evidence (sighting / heard footsteps) across the four recorded turns. */
export function collectEvidence(frames: readonly ReplayFrame[], guardId: string, window: readonly number[]): Evidence[] {
  const items: Evidence[] = [];
  for (const frame of frames) {
    if (!window.includes(frame.turn)) continue;
    const reading = frame.readings.find((candidate) => candidate.id === guardId);
    const guard = frame.guards.find((candidate) => candidate.route.id === guardId);
    if (!reading || !guard) continue;
    const pointsBefore = frame.turn === window[0] ? 0 : pointsAt(frames, guardId, frame.turn - 1);
    if (reading.sawPlayer) {
      items.push({
        key: `${guardId}|${frame.turn}|sight`, guardId, turn: frame.turn, source: "sight",
        cell: reading.clue?.cell ?? guard.cell, pointsBefore, pointsAfter: reading.points, heard: 0
      });
    }
    if (reading.heard > 0) {
      items.push({
        key: `${guardId}|${frame.turn}|sound`, guardId, turn: frame.turn, source: "sound",
        cell: reading.clue?.cell ?? guard.cell, pointsBefore, pointsAfter: reading.points, heard: reading.heard
      });
    }
  }
  return items;
}

function subsets(items: readonly Evidence[]): Evidence[][] {
  const all: Evidence[][] = [];
  for (let mask = 0; mask < 1 << items.length; mask++) {
    all.push(items.filter((_, index) => mask & (1 << index)));
  }
  return all;
}

function mutedKeys(evidence: readonly Evidence[]): Set<string> {
  return new Set(evidence.map((item) => item.key));
}

function differs(baseline: Guard | undefined, current: Guard | undefined): boolean {
  if (!baseline || !current) return true;
  return baseline.mode !== current.mode || baseline.facing !== current.facing
    || !sameCell(baseline.cell, current.cell)
    || (!!baseline.target !== !!current.target)
    || (baseline.target !== null && current.target !== null && !sameCell(baseline.target, current.target));
}

/** First turn where this guard's position / heading / destination departs from the real run. */
export function firstDivergence(baseline: readonly ReplayFrame[], counter: readonly ReplayFrame[], guardId: string): Divergence | null {
  const baselineByTurn = new Map(baseline.map((frame) => [frame.turn, frame]));
  for (const frame of counter) {
    const reference = baselineByTurn.get(frame.turn);
    if (!reference) continue;
    const before = reference.guards.find((guard) => guard.route.id === guardId);
    const after = frame.guards.find((guard) => guard.route.id === guardId);
    if (differs(before, after)) {
      return {
        turn: frame.turn, cell: after!.cell, mode: after!.mode, facing: after!.facing, target: after!.target,
        baselineCell: before!.cell, baselineMode: before!.mode, baselineTarget: before!.target,
        player: frame.actor.cell
      };
    }
  }
  return null;
}

function residualOf(capture: CaptureInfo | null): Residual | null {
  return capture ? { turn: capture.turn, guards: capture.guards, reason: capture.reason } : null;
}

function involvesOther(guardId: string, capture: CaptureInfo | null): boolean {
  return capture !== null && !(capture.guards.length === 1 && capture.guards[0] === guardId);
}

interface Trial {
  readonly subset: readonly Evidence[];
  readonly capture: CaptureInfo | null;
  readonly frames: readonly ReplayFrame[];
}

function pairFindings(evidence: readonly Evidence[], trials: readonly Trial[]): PairFinding[] {
  const findings: PairFinding[] = [];
  const bySubset = (items: readonly Evidence[]) => trials.find((trial) =>
    trial.subset.length === items.length && items.every((item) => trial.subset.includes(item)));
  for (const sight of evidence.filter((item) => item.source === "sight")) {
    const sound = evidence.find((item) => item.source === "sound" && item.turn === sight.turn);
    if (!sound) continue;
    const sightAlone = bySubset([sight]);
    const soundAlone = bySubset([sound]);
    const together = bySubset([sight, sound]);
    if (!sightAlone || !soundAlone || !together) continue;
    findings.push({
      turn: sight.turn, sight, sound,
      sightAloneCaptured: sightAlone.capture !== null,
      soundAloneCaptured: soundAlone.capture !== null,
      togetherCaptured: together.capture !== null
    });
  }
  return findings;
}

function reportFor(level: Level, script: readonly RecordedTurn[], baseline: readonly ReplayFrame[],
  guardId: string, window: readonly number[]): GuardReport {
  const evidence = collectEvidence(baseline, guardId, window);
  if (!evidence.length) {
    return { kind: "window-only", guardId, window, evidence: [] };
  }
  const trials: Trial[] = subsets(evidence).map((subset) => {
    const outcome = replayScript(level, script, mutedKeys(subset));
    return { subset, capture: outcome.capture, frames: outcome.frames };
  });
  const free = trials.filter((trial) => trial.capture === null);
  const fullMuted = trials.find((trial) => trial.subset.length === evidence.length)!;
  const pairs = pairFindings(evidence, trials);

  if (free.length === 0) {
    return {
      kind: "blocked", guardId, window, evidence,
      residual: residualOf(fullMuted.capture),
      residualOther: involvesOther(guardId, fullMuted.capture)
    };
  }

  const size = Math.min(...free.map((trial) => trial.subset.length));
  const minimal: Combo[] = free
    .filter((trial) => trial.subset.length === size)
    .map((trial) => ({ evidence: trial.subset, divergence: firstDivergence(baseline, trial.frames, guardId) }));

  return { kind: "analysis", guardId, window, evidence, minimal, pairs };
}

export function analyzeCapture(level: Level, script: readonly RecordedTurn[]): AnalysisResult | null {
  if (!script.length) return null;
  const baseline = replayScript(level, script, new Set());
  const capture = baseline.capture;
  if (!capture) return null;
  const window = windowTurns(capture.turn);
  const guardIds = baseline.frames[0]?.guards.map((guard) => guard.route.id) ?? [];
  const reports = guardIds.map((guardId) => reportFor(level, script, baseline.frames, guardId, window));
  return { capture, window, reports };
}

export type { AnalysisResult };
