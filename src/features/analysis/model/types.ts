import type { Cell } from "@/shared/grid";
import type { Command, Footstep, GuardPerception, Stance } from "@/shared/world";
import type { Actor } from "@/features/player/model/actor";
import type { Guard } from "@/features/patrol/model/guards";

/** One consumed turn of the real run: the instruction issued and what came of it. */
export interface RecordedTurn {
  readonly turn: number;
  readonly command: Command;
  readonly stance: Stance;
  readonly actor: Actor;
  readonly guards: readonly Guard[];
  readonly readings: readonly GuardPerception[];
  readonly footsteps: readonly Footstep[];
}

export interface CaptureInfo {
  readonly turn: number;
  readonly guards: readonly string[];
  readonly reason: "contact" | "points";
  readonly points: number;
}

export type ClueSource = "sight" | "sound";

/** One perceivable event of a guard: a sighting, or heard footsteps, on one turn. */
export interface Evidence {
  readonly key: string;
  readonly guardId: string;
  readonly turn: number;
  readonly source: ClueSource;
  readonly cell: Cell;
  readonly pointsBefore: number;
  readonly pointsAfter: number;
  readonly heard: number;
}

export interface Divergence {
  readonly turn: number;
  readonly cell: Cell;
  readonly mode: string;
  readonly facing: string;
  readonly target: Cell | null;
  readonly baselineCell: Cell;
  readonly baselineMode: string;
  readonly baselineTarget: Cell | null;
  readonly player: Cell;
}

export interface Combo {
  readonly evidence: readonly Evidence[];
  /** Where this combo first makes the guard change course; null if the route never differs. */
  readonly divergence: Divergence | null;
}

export interface PairFinding {
  readonly turn: number;
  readonly sight: Evidence;
  readonly sound: Evidence;
  readonly sightAloneCaptured: boolean;
  readonly soundAloneCaptured: boolean;
  readonly togetherCaptured: boolean;
}

export interface Residual {
  readonly turn: number;
  readonly guards: readonly string[];
  readonly reason: "contact" | "points";
}

interface GuardBase {
  readonly guardId: string;
  readonly window: readonly number[];
  readonly evidence: readonly Evidence[];
}

/** This guard produced no sighting and heard no footsteps in the four analysed turns. */
export interface WindowOnlyReport extends GuardBase {
  readonly kind: "window-only";
}

/** Every combination of its real evidence was tried, and none avoids the capture. */
export interface BlockedReport extends GuardBase {
  readonly kind: "blocked";
  readonly residual: Residual | null;
  readonly residualOther: boolean;
}

/** At least one combination avoids the capture; `minimal` lists all of the smallest ones. */
export interface AnalysisReport extends GuardBase {
  readonly kind: "analysis";
  readonly minimal: readonly Combo[];
  readonly pairs: readonly PairFinding[];
}

export type GuardReport = WindowOnlyReport | BlockedReport | AnalysisReport;

export interface AnalysisResult {
  readonly capture: CaptureInfo;
  readonly window: readonly number[];
  readonly reports: readonly GuardReport[];
}
