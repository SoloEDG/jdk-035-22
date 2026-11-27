<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Eye, Footprints, Route } from "lucide-vue-next";
import type { AnalysisResult, BlockedReport, Combo, GuardReport, AnalysisReport } from "../model/types";

const props = defineProps<{ analysis: AnalysisResult | null }>();

const chosen = ref("");

const active = computed<GuardReport | null>(() => {
  const result = props.analysis;
  if (!result) return null;
  return result.reports.find((report) => report.guardId === chosen.value) ?? result.reports[0] ?? null;
});

const analysed = computed<AnalysisReport | null>(() => active.value?.kind === "analysis" ? active.value : null);
const blocked = computed<BlockedReport | null>(() => active.value?.kind === "blocked" ? active.value : null);

watch(() => props.analysis, (next) => {
  const preferred = next?.reports.find((report) => report.kind === "analysis") ?? next?.reports[0];
  chosen.value = preferred?.guardId ?? "";
}, { immediate: true });

const sourceLabel = { sight: "目击", sound: "脚步" } as const;
const sourceIcon = { sight: Eye, sound: Footprints } as const;

const verdict = computed(() => {
  const report = active.value;
  if (!report) return "";
  if (report.kind === "blocked") return "无法阻止";
  if (report.kind === "analysis") return `最少 ${report.minimal[0]?.evidence.length ?? 0} 项 · ${report.minimal.length} 组`;
  return "无证据";
});

function evidenceText(combo: Combo) {
  return combo.evidence.map((item) => `${sourceLabel[item.source]} t${two(item.turn)}`).join(" + ");
}

function two(turn: number) {
  return String(turn).padStart(2, "0");
}

function cellText(cell: { x: number; y: number }) {
  return `${String.fromCharCode(65 + cell.y)}${cell.x + 1}`;
}

const modeLabels: Record<string, string> = { patrol: "巡逻", investigate: "调查", search: "搜索", return: "返回" };
function modeText(mode: string) {
  return modeLabels[mode] ?? mode;
}

/** Where the guard is headed: its current waypoint if investigating, else its current cell. */
function destination(mode: string, target: { x: number; y: number } | null, cell: { x: number; y: number }) {
  if (mode === "investigate" && target) return `调查至 ${cellText(target)}`;
  return `${modeText(mode)}（${cellText(target ?? cell)}）`;
}
</script>

<template>
  <section class="status-section analysis-section" aria-labelledby="analysis-heading" data-analysis>
    <div class="section-heading">
      <h2 id="analysis-heading">截获复盘</h2>
      <span class="verdict" :class="active?.kind">{{ verdict }}</span>
    </div>
    <p v-if="!analysis" class="analysis-empty">尚未被截获，暂无可分析的回合。</p>
    <template v-else>
      <div class="analysis-meta">
        <span>截获于第 {{ two(analysis.capture.turn) }} 回合 · {{ analysis.capture.reason === "contact" ? "接触" : "察觉累积" }}</span>
        <span>核对窗口 t{{ analysis.window.map(two).join(" · t") }}</span>
      </div>
      <div class="guard-tabs" role="tablist" aria-label="选择守卫">
        <button v-for="report in analysis.reports" :key="report.guardId" type="button" role="tab"
          :aria-selected="report.guardId === active?.guardId" @click="chosen = report.guardId">
          守卫 {{ report.guardId }}
        </button>
      </div>

      <template v-if="active">
        <ul v-if="active.evidence.length" class="evidence-list" aria-label="原局证据">
          <li v-for="item in active.evidence" :key="item.key">
            <component :is="sourceIcon[item.source]" :size="13" />
            <span>{{ sourceLabel[item.source] }} · t{{ two(item.turn) }}</span>
            <span class="evidence-cell">{{ cellText(item.cell) }}</span>
            <span class="evidence-pts">{{ item.pointsBefore }}→{{ item.pointsAfter }}</span>
          </li>
        </ul>
        <p v-else class="analysis-empty">此守卫在核对窗口内没有目击或听见脚步；仅凭它的感知无法影响本次截获。</p>

        <template v-if="analysed">
          <ol class="combo-list" aria-label="最少屏蔽组合">
            <li v-for="(combo, index) in analysed.minimal" :key="index">
              <span class="combo-rank">{{ index + 1 }}</span>
              <div>
                <p class="combo-evidence">{{ evidenceText(combo) }}</p>
                <p class="combo-divergence">
                  <Route :size="13" />
                  <span v-if="combo.divergence">首次改向 t{{ two(combo.divergence.turn) }}：{{ destination(combo.divergence.baselineMode, combo.divergence.baselineTarget, combo.divergence.baselineCell) }} → {{ destination(combo.divergence.mode, combo.divergence.target, combo.divergence.cell) }}</span>
                  <span v-else>全程未改变去向：仅因察觉点数未达 100 而脱逃。</span>
                </p>
              </div>
            </li>
          </ol>
          <ul class="pair-notes" aria-label="同回合目击与脚步">
            <li v-for="pair in analysed.pairs" :key="pair.turn">
              <span v-if="pair.sightAloneCaptured && pair.soundAloneCaptured && !pair.togetherCaptured">
                t{{ two(pair.turn) }} 的目击与脚步必须一起屏蔽：单去目击仍会被同回合脚步追上。
              </span>
              <span v-else-if="pair.togetherCaptured">
                t{{ two(pair.turn) }} 两项都挡仍被截获，需连同其他证据。
              </span>
            </li>
          </ul>
        </template>

        <template v-if="blocked">
          <p class="blocked-note">
            <template v-if="blocked.residualOther && blocked.residual">
              即使屏蔽 {{ blocked.guardId }} 的全部证据，截获仍由守卫 {{ blocked.residual.guards.join("、") }} 在第 {{ two(blocked.residual.turn) }} 回合{{ blocked.residual.reason === "contact" ? "接触" : "因察觉累积" }}触发；{{ blocked.guardId }} 的线索无法阻止本次截获。
            </template>
            <template v-else-if="blocked.residual">
              全部屏蔽 {{ blocked.guardId }} 的证据仍无法脱逃：<template
                v-if="blocked.residual.reason === 'contact' && blocked.residual.guards.includes(blocked.guardId)">第 {{ two(blocked.residual.turn) }} 回合 {{ blocked.guardId }} 已在原路线中按时走到玩家格上，属于身体接触，与它的目击或脚步无关。</template><template
                v-else-if="blocked.residual.reason === 'contact'">第 {{ two(blocked.residual.turn) }} 回合被守卫 {{ blocked.residual.guards.join("、") }} 接触。</template><template
                v-else>第 {{ two(blocked.residual.turn) }} 回合因守卫 {{ blocked.residual.guards.join("、") }} 察觉累积达到 100 而截获。</template>{{ blocked.guardId }} 自身的线索无法阻止本次截获。
            </template>
            <template v-else>全部屏蔽此守卫的证据仍无法脱逃，说明它的线索不足以阻止本次截获。</template>
          </p>
        </template>
      </template>
    </template>
  </section>
</template>
