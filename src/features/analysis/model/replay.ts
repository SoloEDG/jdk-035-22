import { addCell, directions, sameCell, type Cell, type Direction } from "@/shared/grid";
import type { Footstep, GuardPerception, Level } from "@/shared/world";
import { isWalkable, terrainAt, terrainRules } from "@/features/map";
import { createActor, stances, type Actor } from "@/features/player";
import { advanceGuards, createGuards, respondToClues, type Guard } from "@/features/patrol";
import { measure } from "@/features/alert";
import { markObjective, type Objective } from "@/features/mission";
import type { CaptureInfo, RecordedTurn } from "./types";

export interface ReplayFrame {
  readonly turn: number;
  readonly actor: Actor;
  readonly guards: readonly Guard[];
  readonly readings: readonly GuardPerception[];
  readonly trace: readonly Cell[];
  readonly footsteps: readonly Footstep[];
  readonly waited: boolean;
  readonly capture: CaptureInfo | null;
}

export interface ReplayOutcome {
  readonly frames: readonly ReplayFrame[];
  readonly capture: CaptureInfo | null;
}

interface PlannedMove {
  readonly actor: Actor;
  readonly crossed: readonly Cell[];
  readonly footsteps: readonly Footstep[];
  readonly waited: boolean;
}

/**
 * Re-drives one recorded instruction on the counterfactual board, mirroring resolveCommand.
 * A move whose first step cannot be taken (wall / out of bounds) spends the turn standing still,
 * as required for the comparison; stepping onto a guard's body still moves and contacts the guard.
 */
function planMove(level: Level, actor: Actor, direction: Direction, guards: readonly Guard[]): PlannedMove {
  const stance = stances[actor.stance];
  const crossed: Cell[] = [];
  const footsteps: Footstep[] = [];
  let cell = actor.cell;
  for (let step = 0; step < stance.stride; step++) {
    const next = addCell(cell, directions[direction]);
    if (!isWalkable(level, next)) break;
    cell = next;
    crossed.push(cell);
    const volume = Math.max(0, stance.volume + terrainRules[terrainAt(level, cell)].noise);
    if (volume > 0) footsteps.push({ cell, volume });
    if (guards.some((guard) => sameCell(guard.cell, cell))) break;
  }
  if (!crossed.length) return { actor, crossed: [], footsteps: [], waited: true };
  return { actor: { ...actor, cell, facing: direction }, crossed, footsteps, waited: false };
}

function captureOf(turn: number, guards: readonly Guard[], playerCell: Cell, readings: readonly GuardPerception[]): CaptureInfo | null {
  const touching = guards.filter((guard) => sameCell(guard.cell, playerCell)).map((guard) => guard.route.id);
  const loud = readings.filter((reading) => reading.points >= 100);
  const points = Math.max(0, ...readings.map((reading) => reading.points));
  if (touching.length) return { turn, guards: touching, reason: "contact", points };
  if (loud.length) return { turn, guards: loud.map((reading) => reading.id), reason: "points", points };
  return null;
}

export function replayScript(level: Level, script: readonly RecordedTurn[], muted: ReadonlySet<string>): ReplayOutcome {
  let state: {
    actor: Actor;
    guards: readonly Guard[];
    readings: readonly GuardPerception[];
    objective: Objective;
  } = {
    actor: createActor(level.start),
    guards: createGuards(level),
    readings: [],
    objective: { phase: "retrieve", securedAt: null }
  };
  const frames: ReplayFrame[] = [];
  for (const entry of script) {
    const actor: Actor = { ...state.actor, stance: entry.stance };
    const planned: PlannedMove = entry.command.type === "wait"
      ? { actor, crossed: [], footsteps: [], waited: true }
      : planMove(level, actor, entry.command.direction, state.guards);
    const nextActor = planned.actor;

    const contactBefore = state.guards.some((guard) => sameCell(guard.cell, nextActor.cell));
    const moved = contactBefore ? state.guards : advanceGuards(level, state.guards);
    const sensors = moved.map((guard) => ({ id: guard.route.id, cell: guard.cell, facing: guard.facing }));
    const trace = planned.crossed.length ? planned.crossed : [nextActor.cell];
    const readings = measure(level, sensors, trace, planned.footsteps, state.readings,
      stances[actor.stance].sightGain, { turn: entry.turn, muted });
    const guards = respondToClues(moved, readings);
    const capture = captureOf(entry.turn, guards, nextActor.cell, readings);
    const objective = markObjective(level, state.objective, trace, capture !== null, entry.turn);

    frames.push({ turn: entry.turn, actor: nextActor, guards, readings, trace, footsteps: planned.footsteps, waited: planned.waited, capture });
    state = { actor: nextActor, guards, readings, objective };
    if (capture !== null) break;
    if (objective.phase === "escaped") break;
  }
  return { frames, capture: frames[frames.length - 1]?.capture ?? null };
}
