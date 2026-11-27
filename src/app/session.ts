import { sameCell } from "@/shared/grid";
import type { Command, GuardPerception, RunEvent } from "@/shared/world";
import { archive } from "@/features/map";
import { createActor, resolveCommand, stances, type Actor } from "@/features/player";
import { advanceGuards, createGuards, respondToClues, type Guard } from "@/features/patrol";
import { measure } from "@/features/alert";
import { describeTurn, initialEvent, markObjective, type Objective } from "@/features/mission";
import type { RecordedTurn } from "@/features/analysis/model/types";

export interface Session {
  readonly turn: number;
  readonly actor: Actor;
  readonly guards: readonly Guard[];
  readonly readings: readonly GuardPerception[];
  readonly objective: Objective;
  readonly log: readonly RunEvent[];
  readonly history: readonly RecordedTurn[];
}

export function startSession(): Session {
  return {
    turn: 0,
    actor: createActor(archive.start),
    guards: createGuards(archive),
    readings: [],
    objective: { phase: "retrieve", securedAt: null },
    log: [initialEvent],
    history: []
  };
}

export function applyCommand(session: Session, command: Command): Session {
  if (session.objective.phase === "escaped" || session.objective.phase === "caught") return session;
  const movement = resolveCommand(archive, session.actor, command, session.guards.map((guard) => guard.cell));
  if (!movement) return session;

  const turn = session.turn + 1;
  const contactBefore = session.guards.some((guard) => sameCell(guard.cell, movement.actor.cell));
  const moved = contactBefore ? session.guards : advanceGuards(archive, session.guards);
  const sensors = moved.map((guard) => ({ id: guard.route.id, cell: guard.cell, facing: guard.facing }));
  const trace = movement.crossed.length ? movement.crossed : [movement.actor.cell];
  const readings = measure(archive, sensors, trace, movement.footsteps, session.readings, stances[movement.actor.stance].sightGain);
  const guards = respondToClues(moved, readings);
  const caught = contactBefore || moved.some((guard) => sameCell(guard.cell, movement.actor.cell))
    || readings.some((reading) => reading.points >= 100);
  const objective = markObjective(archive, session.objective, trace, caught, turn);
  const identified = guards.filter((guard, index) => guard.mode === "investigate" && moved[index].mode !== guard.mode)
    .map((guard) => guard.route.id);
  const log = describeTurn({ turn, before: session.objective, after: objective, observations: readings, identified });
  const record: RecordedTurn = {
    turn, command, stance: movement.actor.stance, actor: movement.actor,
    guards: session.guards, readings: session.readings, footsteps: movement.footsteps
  };
  return { turn, actor: movement.actor, guards, readings, objective, log: [...session.log, ...log].slice(-24),
    history: [...session.history, record] };
}
