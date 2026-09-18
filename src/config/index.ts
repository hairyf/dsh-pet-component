import type { CSSProperties } from 'react'
/**
 * 桌宠配置的逻辑层 —— 纯函数、无 React / DOM 依赖，可独立单测。
 *
 * 职责：
 * 1. **常量**：画布几何、命中箱、默认尺寸、Codex 图集几何。
 * 2. **协议拾取器**：从 dsh-pet `source/dsh-pet/dsh-pet/src/shared/pickers.ts`
 *    移植的权重掷骰与分类池抽取（`pick` / `rollKind` / `pickWeightedCategory` /
 *    `pickCategoryAction`）。
 * 3. **动作 → 动画名解析**：`Motion` 落到具体资源名（`resolveDshAnimation`），
 *    以及 Codex 图集行解析（`resolveCodexFrame`）。
 * 4. **形状判定与归一化**：`isDshPetConfig` / `isCodexPetConfig` / `detectPetKind` /
 *    `resolvePetSize`。
 *
 * 与参考实现对位关系：
 * - `source/deepseek-harness-desktop/src/pet/config/index.ts`（同作者）
 * - `source/dsh-pet/dsh-pet/src/shared/pickers.ts`
 * - `source/codex-to-dsh-pet/packages/dsh-codex-pet/src/registry.js`（图集契约）
 */
import type {
  Category,
  CodexPetConfig,
  CodexPetFrameSpec,
  DshPetAnimations,
  DshPetConfig,
  DshPetEntry,
  EventSlot,
  Motion,
  PetConfig,
  PetRenderMotion,
  PetWeights,
  PhysicsParams,
} from '../types'
import { MOTIONS } from '../types/motion'

/* -------------------------------------------------------------------------- */
/* 常量                                                                        */
/* -------------------------------------------------------------------------- */

/** 基准宠物宽（px）：与 dsh-pet 640×360 缩略画布下「基准宠物宽 462px」一致。 */
export const PET_BASE_WIDTH = 462

/** dsh-pet 视频画布宽高比（高 / 宽 = 9/16）。 */
export const PET_ASPECT_RATIO = 9 / 16

/** 默认显示宽度（px）。 */
export const PET_DEFAULT_SIZE = 220

/**
 * Codex 渲染器的默认显示宽度（px）—— **基准的一半**。
 *
 * 两套协议的「同宽度」完全不是同一个视觉大小：
 * - dsh-pet 是 640×360 的透明视频画布，人物只占中间一块（`PET_HIT_BOX` ≈ 画布宽的
 *   37.5%、高的 79%），盒子宽 462px 时人物约 173px 宽；
 * - Codex 是 192×208 的格子，人物基本铺满格子，同样 462px 宽会画成约 370px 的人物
 *   —— 也就是「整体偏大」的观感，差不多是 dsh-pet 的两倍。
 *
 * 所以默认按一半取，让两种协议的默认观感对齐（`CodexPetConfig.size` 或 `size` prop
 * 给了值就按给的来）。
 */
export const CODEX_DEFAULT_SIZE = PET_BASE_WIDTH / 2

/** 默认尺寸百分比（相对 `PET_BASE_WIDTH`）——`size` prop 缺省时的缩放基准。 */
export const PET_DEFAULT_SIZE_PERCENT = 100

/** 尺寸百分比下限。 */
export const PET_SIZE_MIN_PERCENT = 50

/** 尺寸百分比上限。 */
export const PET_SIZE_MAX_PERCENT = 200

/** 默认动作。 */
export const PET_DEFAULT_MOTION: Motion = 'idle'

/** 一次性动作播完回落的目标动作。 */
export const PET_FALLBACK_MOTION: Motion = 'idle'

/** 默认资源后缀（`ext` prop 缺省值）。 */
export const PET_DEFAULT_EXT: { default: string, mac: string } = { default: 'webm', mac: 'mov' }

/** dsh-pet 发布格式后缀（VP9-alpha）。 */
export const PET_WEBM_EXT = 'webm'

/** macOS 交付格式后缀（HEVC-with-Alpha）。 */
export const PET_MOV_EXT = 'mov'

/**
 * 命中箱（视频筐内百分比）—— 与 dsh-pet `.dsh-pet-hit` 完全一致
 * （`source/dsh-pet/dsh-pet/src/shared/constants.ts` 的 `HIT_BOX`：
 * 640×360 画布坐标 `x0:200 y0:50 x1:440 y1:335`，换算成百分比）。
 * 命中区 = 宠物身体：视频/透明区域不响应指针事件。
 */
export const PET_HIT_BOX: CSSProperties = {
  left: '31.25%',
  top: '13.8888888889%',
  width: '37.5%',
  height: '79.1666666667%',
}

/* -------------------------------------------------------------------------- */
/* Codex 图集契约                                                              */
/* -------------------------------------------------------------------------- */

/** Codex 图集格子宽（px）。 */
export const CODEX_FRAME_WIDTH = 192

/** Codex 图集格子高（px）。 */
export const CODEX_FRAME_HEIGHT = 208

/** Codex 图集列数（契约固定 8 列）。 */
export const CODEX_COLUMNS = 8

/** v1 图集行数（9 行，无 look 格）。 */
export const CODEX_ROWS_V1 = 9

/** v2 图集行数（11 行 = 9 行动作 + 2 行 × 8 格 look）。 */
export const CODEX_ROWS_V2 = 11

/** look 格起始行（v2）。 */
export const CODEX_LOOK_START_ROW = 9

/** look 格总数（16 = 每 22.5° 一格）。 */
export const CODEX_LOOK_CELLS = 16

/** Codex look 的默认作用半径系数：`max(宽, 高) * 它`，出界即回待机帧。 */
export const CODEX_LOOK_RADIUS_FACTOR = 1.25

/** 解析后的 Codex 帧定义。 */
export interface CodexResolvedFrame {
  /** 行号（0 起） */
  row: number
  /** 帧数（列数） */
  frames: number
  /** 每帧时长 ms（`durations` 缺项时的回落值） */
  interval: number
  /** 逐帧时长 ms（可选；第 N 项 = 第 N 帧停留时长，优先级高于 `interval`） */
  durations?: readonly number[]
  /** 是否循环 */
  loop: boolean
}

/**
 * Codex 图集内置动作表（行号对齐 Codex 契约；`source/codex-to-dsh-pet` 的 `ANIMATIONS`）。
 *
 * idle 的逐帧时长对齐参考实现 `dsh-plugin-codex-pets` 的 `IDLE_DURATIONS`
 *（首/末帧为长停留的「呼吸」帧）——匀速 160ms 会让 idle 看起来切帧过快、从不停顿。
 */
export const CODEX_ACTIONS: Record<string, CodexResolvedFrame> = {
  idle: { row: 0, frames: 6, interval: 160, durations: [280, 110, 110, 140, 140, 320], loop: true },
  movingRight: { row: 1, frames: 8, interval: 120, loop: true },
  movingLeft: { row: 2, frames: 8, interval: 120, loop: true },
  waving: { row: 3, frames: 4, interval: 140, loop: false },
  jumping: { row: 4, frames: 5, interval: 140, loop: false },
  failed: { row: 5, frames: 8, interval: 140, loop: false },
  waiting: { row: 6, frames: 6, interval: 150, loop: true },
  running: { row: 7, frames: 6, interval: 120, loop: true },
  review: { row: 8, frames: 6, interval: 150, loop: false },
}

/** 默认 Codex 动作。 */
export const CODEX_DEFAULT_ACTION = 'idle'

/** Codex 动作名别名（兼容 dsh-pet 风格的写法）。 */
export const CODEX_ACTION_ALIASES: Record<string, string> = {
  'running-right': 'movingRight',
  'running-left': 'movingLeft',
  'run-right': 'movingRight',
  'run-left': 'movingLeft',
  'run': 'running',
  'moving-right': 'movingRight',
  'moving-left': 'movingLeft',
}

/**
 * `Motion` → Codex 图集动作名。
 *
 * Codex 契约只有 9 行（v1）/ 11 行（v2），没有 dsh-pet 的细分工作档行，也没有专门的
 * 拖拽悬浮行，所以细分档与手势态按参考实现（`spriteStatusFallback` + `spriteAction` 的
 * turn/dragging 映射）近似落到最接近的行：`thinking→waiting`、`working→running`、
 * `result→review`、`success→waving`、`error/failed→failed`、`turn→movingRight`、
 * `dragging→movingRight`（方向由调用方通过动作覆盖）。
 */
export const CODEX_MOTION_ACTION: Record<PetRenderMotion, string> = {
  'idle': 'idle',
  'turn': 'movingRight',
  'moving-left': 'movingLeft',
  'moving-right': 'movingRight',
  'waving': 'waving',
  'thinking': 'waiting',
  'working': 'running',
  'result': 'review',
  'waiting': 'waiting',
  'running': 'running',
  'review': 'review',
  'failed': 'failed',
  'success': 'waving',
  'error': 'failed',
  'dragging': 'movingRight',
}

/* -------------------------------------------------------------------------- */
/* 动作语义                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 常驻循环的动作：没有「播完」概念，直到被别的动作顶替。
 *
 * 与参考实现 `isLoopingAnimation` 一致 —— 细分工作档里非终态的四个
 * （thinking/working/result/waiting）常驻循环，终态的 success/error 播一次回落；
 * 基础姿态里只有 idle 与移动是循环，`turn`/`waving` 是一次性风味动作。
 *
 * `dragging`（手势态）同样常驻循环 —— 拖拽期间要一直「悬空浮动」。参考实现里
 * dsh-pet 应用把拖拽动画播一次后停在末帧，这里取循环：持续拖拽时观感更连贯，
 * 也与 `deepseek-harness-desktop` 的 `isLoopingAnimation('dragging') === true` 一致。
 */
export const LOOPING_MOTIONS: readonly Motion[] = [
  'idle',
  'moving-left',
  'moving-right',
  'thinking',
  'working',
  'result',
  'waiting',
  'running',
]

/** 动作是否常驻循环（`loop` 缺省时的语义）。手势态 `dragging` 恒为循环。 */
export function isLoopingMotion(motion: PetRenderMotion): boolean {
  if (motion === 'dragging')
    return true
  return LOOPING_MOTIONS.includes(motion)
}

/** 细分工作档位在 `animations.events.workStatus` 里的索引（dsh-pet 协议顺序）。 */
export const WORK_STATUS_INDEX: Partial<Record<Motion, number>> = {
  thinking: 0,
  working: 1,
  result: 2,
  waiting: 3,
  success: 4,
  error: 5,
}

/** 旧粗态动作 → 细分档位动作。 */
export const COARSE_MOTION_ALIAS: Partial<Record<Motion, Motion>> = {
  running: 'working',
  review: 'result',
  failed: 'error',
}

/** 宽松动作别名（历史/外部写法 → 渲染层动作）。 */
export const MOTION_ALIASES: Record<string, PetRenderMotion> = {
  'running-right': 'moving-right',
  'running-left': 'moving-left',
  'run-right': 'moving-right',
  'run-left': 'moving-left',
  'run': 'running',
  'dragging': 'dragging',
  'drag': 'dragging',
  'grabbed': 'dragging',
  'wave': 'waving',
  'bubble': 'waving',
  'sleep': 'idle',
  'sleeping': 'idle',
}

/**
 * 任意字符串 → 渲染层动作（已知动作 / 别名 / 手势态 `dragging`），不认识返回 `null`。
 *
 * 注意 `dragging` 归一化为手势态本身，而不是某个方向：它该落到哪个资源由渲染器决定
 * （dsh-pet 用 `animations.drag` 悬浮池，Codex 按方向落到左右行走行）。
 */
export function normalizeMotion(value: string): PetRenderMotion | null {
  if ((MOTIONS as readonly string[]).includes(value))
    return value as Motion
  return MOTION_ALIASES[value] ?? null
}

/* -------------------------------------------------------------------------- */
/* 拾取器（移植自 dsh-pet src/shared/pickers.ts）                               */
/* -------------------------------------------------------------------------- */

/** 动画链掷骰结果类别。 */
export type PetRollKind = 'idle' | 'turn' | 'move' | 'action'

/**
 * 从池中等概率抽一个。
 *
 * @param pool 候选池
 * @param exclude 排除项（避免连续重复）；排除后池空则退回原池（宁可重复也不返回空）
 * @param random 随机源，缺省 `Math.random`（可注入便于单测）
 */
export function pick<T>(pool: readonly T[], exclude?: T, random: () => number = Math.random): T | undefined {
  if (pool.length === 0)
    return undefined
  const entries = exclude === undefined ? pool : pool.filter(item => item !== exclude)
  const source = entries.length > 0 ? entries : pool
  const index = Math.min(source.length - 1, Math.floor(random() * source.length))
  return source[index]
}

/**
 * 按权重掷骰：`roll ∈ [0,1)` → 下一个动画类别。
 *
 * `topEnd = (idle + turn + move) / 100`，剩余概率归入 `action`（分类池）。
 */
export function rollKind(roll: number, weights: PetWeights): PetRollKind {
  const total = weights.idle + weights.turn + weights.move
  if (total <= 0)
    return 'action'
  if (roll < weights.idle / 100)
    return 'idle'
  if (roll < (weights.idle + weights.turn) / 100)
    return 'turn'
  if (roll < total / 100)
    return 'move'
  return 'action'
}

/**
 * 按权重在分类池里选一个分类；`noMirror` 分类在镜像（`facing === 'right'`）时被排除，
 * 剩余权重自动归一化。分类池为空返回 `null`。
 */
export function pickWeightedCategory(
  categories: readonly Category[],
  facing: 'left' | 'right',
  random: () => number = Math.random,
): Category | null {
  const cats = categories.filter(category => Array.isArray(category.actions) && category.actions.length > 0)
  if (cats.length === 0)
    return null
  const filtered = cats.filter(category => !(category.noMirror === true && facing === 'right'))
  const eligible = filtered.length > 0 ? filtered : cats
  const totalWeight = eligible.reduce((sum, category) => sum + Math.max(0, category.weight), 0) || 1
  let target = random() * totalWeight
  for (const category of eligible) {
    target -= Math.max(0, category.weight)
    if (target <= 0)
      return category
  }
  return eligible[eligible.length - 1] ?? null
}

/** 从分类池选一个动作；无可用分类时回退 idle 池。 */
export function pickCategoryAction(
  categories: readonly Category[],
  idlePool: readonly string[],
  facing: 'left' | 'right',
  current?: string,
  random: () => number = Math.random,
): { id: string, name: string | undefined } {
  const category = pickWeightedCategory(categories, facing, random)
  if (category === null)
    return { id: 'FALLBACK', name: pick(idlePool, current, random) }
  return { id: category.id, name: pick(category.actions, current, random) }
}

/* -------------------------------------------------------------------------- */
/* 空闲掷骰链                                                                  */
/* -------------------------------------------------------------------------- */

/** 一次空闲插播的抽取结果。 */
export interface IdleRollPick {
  /** 动画名（资源文件名主名） */
  name: string
  /** 插播动作类别（一次性风味动作，播完回 idle） */
  motion: Motion
}

/**
 * 空闲掷骰：`idle` 持续期间按 `animationWeights` 权重决定下一次插播。
 *
 * - `turn` 命中 → turn 池抽一个（`motion: 'turn'`）
 * - `action` 命中 → 分类池按权重抽一个动作（`motion: 'waving'`，一次性风味动画）
 * - `idle` / `move` 命中 → 返回 `null`（继续待机；组件不自动漫游，`move` 档保留协议语义）
 */
export function pickIdleRoll(options: {
  weights: PetWeights
  turnPool: readonly string[]
  idlePool: readonly string[]
  categories: readonly Category[]
  facing: 'left' | 'right'
  current?: string
  random?: () => number
}): IdleRollPick | null {
  const { weights, turnPool, idlePool, categories, facing, current } = options
  const random = options.random ?? Math.random
  const kind = rollKind(random(), weights)

  if (kind === 'turn' && turnPool.length > 0) {
    const name = pick(turnPool, current, random)
    if (name !== undefined && name !== current)
      return { name, motion: 'turn' }
  }

  if (kind === 'action' && categories.length > 0) {
    const action = pickCategoryAction(categories, idlePool, facing, current, random)
    if (action.name !== undefined && action.name !== current)
      return { name: action.name, motion: 'waving' }
  }

  return null
}

/* -------------------------------------------------------------------------- */
/* dsh-pet 动作 → 动画名                                                       */
/* -------------------------------------------------------------------------- */

/** 事件档位槽位 → 候选池。 */
export function slotToPool(slot: EventSlot | undefined): string[] {
  if (slot === undefined)
    return []
  return typeof slot === 'string' ? (slot === '' ? [] : [slot]) : slot.filter(name => name !== '')
}

/**
 * 拖拽悬浮动画池（协议字段 `animations.drag`）。
 *
 * dsh-pet 的契约注释写得很明确：「每一项都必须是"被无形抓起悬空"的姿势」。
 * 拖动宠物时唯一的合法来源就是这里。
 */
export function dshDragPool(animations: DshPetAnimations | undefined): string[] {
  return (animations?.drag ?? []).filter(Boolean)
}

/**
 * 自动漫游动画池（协议字段 `animations.moves.actions[].name`）。
 *
 * 这套素材（螃蟹走路 / 原地漂浮踏步 / 原地左转奔跑…）的几何是给「整只宠物在屏幕上走」
 * 用的：`moves.default` 里的 minDist/maxDist/margin/leadSec/tailSec 描述行进距离与首尾停顿。
 * 本组件不掌管窗口位置，所以**不替宿主驱动漫游** —— 但 `moving-left` / `moving-right`
 * 会原样取这个池，宿主自己移动宠物（或纯手动触发）时就有走路动画可用。
 */
export function dshMovePool(animations: DshPetAnimations | undefined): string[] {
  return (animations?.moves?.actions ?? []).map(action => action.name).filter(Boolean)
}

/**
 * 随机动作分类池（协议字段 `animations.categories`）—— 把所有分类的 `actions` 摊平。
 *
 * 空闲掷骰链走的是**按权重**的分类抽取（`pickWeightedCategory`，`noMirror` 分类还会被
 * 镜像排除），这个摊平版本给「只想要一个大池子等概率抽」的场合用。
 */
export function dshCategoryPool(animations: DshPetAnimations | undefined): string[] {
  return (animations?.categories ?? []).flatMap(category => category.actions ?? []).filter(Boolean)
}

/**
 * 事件动画池（协议字段 `animations.events.<事件名>`）。
 *
 * 事件的形状是「档位数组」：外层索引即档位，每档的值可以是单个动画名或候选数组。
 * 两种取法对应协议里两种触发方式：
 * - **给 `tier`** → 该档的候选池（`balance` 按余额百分比分档、`workStatus` 按状态档位）；
 * - **不给 `tier`** → 整池摊平（`whisper` 就是这种：到点从整池随机抽一段播）。
 *
 * dsh-pet 现役事件见 `dshEventPool.test` 与 `assets/config.jsonc`（`balance` / `whisper` /
 * `workStatus`，未知名返回空池）。
 */
export function dshEventPool(
  animations: DshPetAnimations | undefined,
  event: string,
  tier?: number,
): string[] {
  const tiers = animations?.events?.[event]
  if (!Array.isArray(tiers))
    return []
  if (tier === undefined)
    return tiers.flatMap(slotToPool)
  return slotToPool(tiers[Math.max(0, Math.floor(tier))])
}

/**
 * 余额档位：与协议注释一致 —— `usedPercent` 是**已用百分比**（0..100），
 * 恰好 100（全部用完）走格外档 5，其余按 20 一段分 0..4 档。
 */
export function dshBalanceTier(usedPercent: number): number {
  if (!Number.isFinite(usedPercent) || usedPercent <= 0)
    return 0
  if (usedPercent >= 100)
    return 5
  return Math.floor(usedPercent / 20)
}

/**
 * 池槽位 = 15 个动作槽（14 个动作 + 手势态 `dragging`）+ 协议里靠权重/事件驱动的其余池。
 * 后两者不是「会话动作」，所以不进 `Motion`，但同样需要有地方解析。
 */
export type DshPoolSlot = PetRenderMotion | 'categories' | `events.${string}`

/**
 * 池槽位 → dsh-pet `animations` 里的候选池 —— 覆盖协议 `animations` 段的**全部**字段。
 *
 * | 槽位 | 协议字段 |
 * | --- | --- |
 * | `idle` | `animations.idle` |
 * | `turn` | `animations.turn`（缺省回落 idle） |
 * | `dragging` | `animations.drag`（「被无形抓起悬空」，拖拽唯一使用的池） |
 * | `moving-left` / `moving-right` | `animations.moves.actions[].name`（走路动画，可手动触发） |
 * | `waving` | `animations.clicks`（点击回应） |
 * | `categories` | `animations.categories`（摊平） |
 * | `thinking`…`error` | `animations.events.workStatus[0..5]` |
 * | `running` / `review` / `failed` | 旧粗态 → 对应 workStatus 档位 |
 * | `events.<名>` | `animations.events.<名>` 整池摊平；需要具体档位用 `dshEventPool(…, tier)` |
 *
 * 注意 `dragging` 与 `moving-*` 走的是**两个不同**的池：拖动是「被抓起悬空」，
 * 左右移动是走路 —— 前者由组件的手势态触发，后者由宿主自己驱动移动时手动下发。
 */
export function dshMotionPool(slot: DshPoolSlot, animations: DshPetAnimations | undefined): string[] {
  if (animations === undefined)
    return []

  if (slot === 'categories')
    return dshCategoryPool(animations)
  if (slot.startsWith('events.'))
    return dshEventPool(animations, slot.slice('events.'.length))

  switch (slot) {
    case 'idle':
      return (animations.idle ?? []).filter(Boolean)
    case 'turn':
      return (animations.turn ?? animations.idle ?? []).filter(Boolean)
    case 'dragging':
      return dshDragPool(animations)
    case 'moving-left':
    case 'moving-right':
      return dshMovePool(animations)
    case 'waving':
      return (animations.clicks ?? []).filter(Boolean)
    default: {
      // 走到这里只可能是 14 个动作之一（dragging / categories / events.* 上面已经分流）
      const motion = slot as Motion
      const alias = COARSE_MOTION_ALIAS[motion]
      if (alias !== undefined)
        return dshMotionPool(alias, animations)
      const tier = WORK_STATUS_INDEX[motion]
      if (tier === undefined)
        return []
      return dshEventPool(animations, 'workStatus', tier)
    }
  }
}

/**
 * 把动作解析成一个具体的动画名（资源文件名主名），解析不到返回 `null`。
 *
 * 优先级：
 * 1. `config.motions[motion]`（顶层显式映射）
 * 2. `config.animations.motions[motion]`（`animations` 段内的显式映射）
 * 3. 协议池（见 `dshMotionPool`）
 * 4. `idle` 池兜底
 */
export function resolveDshAnimation(options: {
  motion: PetRenderMotion
  config: DshPetConfig | null | undefined
  /** 当前正在播的动画名（尽量不连续重复） */
  previous?: string
  random?: () => number
}): string | null {
  const { motion, config, previous, random = Math.random } = options
  if (config == null)
    return null

  const explicit = config.motions?.[motion] ?? config.animations?.motions?.[motion]
  if (explicit !== undefined) {
    const name = pick(slotToPool(explicit), previous, random)
    if (name !== undefined)
      return name
  }

  const pool = dshMotionPool(motion, config.animations)
  if (pool.length > 0) {
    const name = pick(pool, previous, random)
    if (name !== undefined)
      return name
  }

  if (motion !== PET_DEFAULT_MOTION) {
    const name = pick(dshMotionPool(PET_DEFAULT_MOTION, config.animations), previous, random)
    if (name !== undefined)
      return name
  }

  return null
}

/* -------------------------------------------------------------------------- */
/* Codex 图集解析                                                              */
/* -------------------------------------------------------------------------- */

/** 图集行数：显式 `rows` > `spriteVersionNumber` > 默认 v2（11 行）。 */
export function resolveCodexRows(config: CodexPetConfig | null | undefined): number {
  if (config?.rows !== undefined && Number.isFinite(config.rows) && config.rows > 0)
    return Math.floor(config.rows)
  if (config?.spriteVersionNumber === 1)
    return CODEX_ROWS_V1
  return CODEX_ROWS_V2
}

/** 图集列数（默认 8）。 */
export function resolveCodexColumns(config: CodexPetConfig | null | undefined): number {
  if (config?.columns !== undefined && Number.isFinite(config.columns) && config.columns > 0)
    return Math.floor(config.columns)
  return CODEX_COLUMNS
}

/** 图集是否为 v2（有 look 格）。 */
export function isCodexLookSupported(config: CodexPetConfig | null | undefined): boolean {
  return resolveCodexRows(config) > CODEX_ROWS_V1
}

/**
 * 动作 → 图集帧定义。
 *
 * `config.motions[motion]` 支持三种写法：数字（行号，用内置帧数/帧率）、
 * `{ row, frames?, interval?, loop? }` 覆盖、或缺失（走内置映射表）。
 */
export function resolveCodexFrame(
  motion: PetRenderMotion,
  config: CodexPetConfig | null | undefined,
): CodexResolvedFrame {
  const actionName = CODEX_MOTION_ACTION[motion]
  const base = CODEX_ACTIONS[actionName] ?? CODEX_ACTIONS[CODEX_DEFAULT_ACTION]!
  const custom: number | CodexPetFrameSpec | undefined = config?.motions?.[motion]

  if (custom === undefined)
    return { ...base, loop: base.loop || isLoopingMotion(motion) }

  const spec: CodexPetFrameSpec = typeof custom === 'number' ? { row: custom } : custom
  const row = Number.isFinite(spec.row) ? Math.max(0, Math.floor(spec.row)) : base.row
  const frames = spec.frames !== undefined && spec.frames > 0 ? Math.floor(spec.frames) : base.frames
  const interval = spec.interval !== undefined && spec.interval > 0 ? spec.interval : base.interval
  const durations = spec.durations ?? base.durations
  return { row, frames, interval, durations, loop: spec.loop ?? isLoopingMotion(motion) }
}

/**
 * 指针方向 → look 格序号（0..15，每 22.5° 一格）。
 *
 * @param direction 指针相对宠物中心的方向（`{ x, y }`，y 向下为正）；给数字则直接当角度
 * @param deadzone 死区半径（小于等于它视为「没在看」）
 * @returns look 格序号；死区内或方向非法返回 `undefined`
 */
export function resolveLookIndex(
  direction: { x: number, y: number } | number | null | undefined,
  deadzone = 0,
): number | undefined {
  if (direction === null || direction === undefined)
    return undefined

  let degrees: number
  if (typeof direction === 'number') {
    degrees = direction
  }
  else {
    if (!Number.isFinite(direction.x) || !Number.isFinite(direction.y))
      return undefined
    const magnitude = Math.hypot(direction.x, direction.y)
    if (magnitude === 0 || magnitude <= Math.max(0, deadzone))
      return undefined
    degrees = (Math.atan2(direction.x, -direction.y) * 180) / Math.PI
  }

  if (!Number.isFinite(degrees))
    return undefined
  const normalized = ((degrees % 360) + 360) % 360
  return Math.round(normalized / 22.5) % CODEX_LOOK_CELLS
}

/* -------------------------------------------------------------------------- */
/* 形状判定 / 归一化                                                           */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isDshMotionMap(value: unknown): boolean {
  if (!isRecord(value))
    return false
  const entries = Object.values(value)
  if (entries.length === 0)
    return false
  return entries.every(entry => typeof entry === 'string' || isStringArray(entry))
}

function isCodexMotionMap(value: unknown): boolean {
  if (!isRecord(value))
    return false
  const entries = Object.values(value)
  if (entries.length === 0)
    return false
  return entries.every(entry => typeof entry === 'number' || (isRecord(entry) && typeof entry.row === 'number'))
}

/** 是否像 dsh-pet 配置（`config.jsonc` 协议）。 */
export function isDshPetConfig(value: unknown): value is DshPetConfig {
  if (!isRecord(value))
    return false
  return isRecord(value.animations)
    || Array.isArray(value.pets)
    || isRecord(value.animationWeights)
    || isRecord(value.physics)
    || isRecord(value.eventsRefreshSec)
    || typeof value.whisperPrompt === 'string'
    || isDshMotionMap(value.motions)
}

/** 是否像 Codex 精灵图配置（`pet.json` 协议）。 */
export function isCodexPetConfig(value: unknown): value is CodexPetConfig {
  if (!isRecord(value))
    return false
  return typeof value.spriteVersionNumber === 'number'
    || typeof value.spritesheetPath === 'string'
    || typeof value.frameWidth === 'number'
    || typeof value.frameHeight === 'number'
    || typeof value.columns === 'number'
    || isCodexMotionMap(value.motions)
}

const IMAGE_EXT_PATTERN = /\.(?:webp|png|gif|avif|jpe?g)(?:[?#]|$)/i

/**
 * 判定该用哪个渲染器。
 *
 * 1. 只像一种 → 直接选它；
 * 2. 两种都像（例如只有一个 `motions` 映射）→ 看 `uri`：图片扩展名 = codex，
 *    对象（`{ default, mac }`）/ 目录 = dsh；
 * 3. 都不像 → 同样看 `uri`，最后回落到 dsh（视频渲染器兼容性更好）。
 */
export function detectPetKind(config: PetConfig | null | undefined, uri?: unknown): 'dsh' | 'codex' {
  const dsh = config == null ? false : isDshPetConfig(config)
  const codex = config == null ? false : isCodexPetConfig(config)

  if (codex && !dsh)
    return 'codex'
  if (dsh && !codex)
    return 'dsh'

  if (typeof uri === 'string' && IMAGE_EXT_PATTERN.test(uri))
    return 'codex'
  if (isRecord(uri))
    return 'dsh'
  return 'dsh'
}

/** 取配置里要渲染的宠物条目（`petId` 缺省取第一个）。 */
export function selectPetEntry(
  config: DshPetConfig | null | undefined,
  petId?: string,
): DshPetEntry | undefined {
  const pets = config?.pets
  if (!Array.isArray(pets) || pets.length === 0)
    return undefined
  if (petId === undefined)
    return pets[0]
  return pets.find(pet => pet.id === petId) ?? pets[0]
}

/**
 * 解析显示宽度（px）：`size` prop > 配置 `size` > 宠物条目 `size` > 渲染器的默认基准。
 *
 * 两种协议的默认基准不同（见 `CODEX_DEFAULT_SIZE`）：同样的宽度在 Codex 上会画成
 * 差不多两倍大的人物，所以 `CodexPet` 通过 `fallbackSize` 传自己的基准。
 */
export function resolvePetSize(options: {
  size?: number
  sizePercent?: number
  config?: DshPetConfig | CodexPetConfig | null
  petEntry?: DshPetEntry
  /** 都没有时用的基准宽度；缺省按 `PET_BASE_WIDTH` × 百分比 */
  fallbackSize?: number
}): number {
  const { size, sizePercent = PET_DEFAULT_SIZE_PERCENT, config, petEntry, fallbackSize } = options
  if (typeof size === 'number' && Number.isFinite(size) && size > 0)
    return size

  const fromConfig = config?.size
  if (typeof fromConfig === 'number' && Number.isFinite(fromConfig) && fromConfig > 0)
    return fromConfig

  const fromPet = petEntry?.size
  if (typeof fromPet === 'number' && Number.isFinite(fromPet) && fromPet > 0)
    return fromPet

  if (fallbackSize !== undefined && Number.isFinite(fallbackSize) && fallbackSize > 0)
    return fallbackSize

  const clamped = Math.min(PET_SIZE_MAX_PERCENT, Math.max(PET_SIZE_MIN_PERCENT, sizePercent))
  return (PET_BASE_WIDTH * clamped) / 100
}

/** 归一化 `animationWeights`（缺省 dsh-pet 内置权重 10 / 5 / 5）。 */
export function resolveWeights(weights: Partial<PetWeights> | undefined): PetWeights {
  return {
    idle: finiteOr(weights?.idle, 10),
    turn: finiteOr(weights?.turn, 5),
    move: finiteOr(weights?.move, 5),
  }
}

/** 归一化 `physics`（缺省值与 dsh-pet `src/shared/physics.ts` 常量一致）。 */
export function resolvePhysics(physics: Partial<PhysicsParams> | undefined): PhysicsParams {
  return {
    gravity: finiteOr(physics?.gravity, 1400),
    restitution: finiteOr(physics?.restitution, 0.78),
    groundFriction: finiteOr(physics?.groundFriction, 2.5),
    ceilingBounce: physics?.ceilingBounce ?? true,
    throwPower: finiteOr(physics?.throwPower, 1),
    petCollision: physics?.petCollision ?? false,
  }
}

/** 配置是否声明了空闲掷骰链所需的素材（用于 `idleRoll` 的缺省值）。 */
export function supportsIdleRoll(config: DshPetConfig | null | undefined): boolean {
  if (config == null)
    return false
  if (config.animationWeights !== undefined)
    return true
  return (config.animations?.categories?.length ?? 0) > 0
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/* -------------------------------------------------------------------------- */
/* 碎碎念（whisper）与配图                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 碎碎念气泡的默认展示时长 ms —— 与 dsh-pet `client/pet.ts` 的
 * `BUBBLE_DURATION_MS = 10 * 1000` 一致：到点自动收起、与动画生命周期解耦
 * （动画被点击/拖拽打断也不影响气泡按时消失）。
 */
export const MUTTERING_DURATION_MS = 10_000

/**
 * 碎碎念周期缺省值（秒）：配置没写 `eventsRefreshSec.whisper` 时用它。
 *
 * 上游现役配置里是 300（`dsh-pet/assets/config.jsonc`），而它的客户端在配置缺失时
 * 回落到 3600（`dsh-pet/src/client/pet.ts` 的 `?? 3600`）—— 这里沿用同一个回落值，
 * 避免组件比上游更激进地打模型。
 */
export const MUTTERING_FALLBACK_INTERVAL_SEC = 3600

/** 碎碎念最小周期（秒）：对应 dsh-pet 客户端的 `Math.max(1000, sec * 1000)`。 */
export const MUTTERING_MIN_INTERVAL_SEC = 1

/** 一次碎碎念的运行参数（已按 `prop > pets[i] > 顶层 > 缺省` 收敛）。 */
export interface MutteringPlan {
  /** 是否启用自动碎碎念 */
  enabled: boolean
  /** 配置里的宠物 id（进事件载荷） */
  petId?: string
  /** system 提示词（`whisperPrompt`）；无配置时是空串 */
  prompt: string
  /** 生效周期（秒，已钳制） */
  intervalSec: number
  /** 生效周期（ms，`intervalSec * 1000`） */
  intervalMs: number
  /** 是否抽配图 */
  image: boolean
  /** 首拍是否即索取（`false` = 对齐 dsh-pet「首拍只记基线」） */
  immediate: boolean
  /** 气泡展示时长 ms */
  duration: number
}

/** `resolveMutteringPlan` 的入参：配置 + 宠物条目 + 组件 props 覆盖。 */
export interface MutteringPlanInput {
  config?: DshPetConfig | null
  entry?: DshPetEntry | null
  /** `muttering` prop（`undefined` = 回落 `pets[i].whisperEnabled`） */
  enabled?: boolean
  /** `mutteringPrompt` prop */
  prompt?: string
  /** `mutteringIntervalSec` prop（秒） */
  intervalSec?: number
  /** `mutteringImmediate` prop */
  immediate?: boolean
  /** `mutteringImage` prop（`undefined` = 回落 `whisperImageEnabled`） */
  image?: boolean
  /** `mutteringDuration` prop（ms） */
  duration?: number
}

/**
 * 收敛碎碎念的运行参数。
 *
 * | 字段 | prop | 宠物条目 | 顶层配置 | 缺省 |
 * | --- | --- | --- | --- | --- |
 * | 开关 | `muttering` | `pets[i].whisperEnabled` | — | `false` |
 * | 提示词 | `mutteringPrompt` | — | `whisperPrompt` | `''` |
 * | 周期 | `mutteringIntervalSec` | `pets[i].eventsRefreshSec.whisper` | `eventsRefreshSec.whisper` | 3600 |
 * | 配图 | `mutteringImage` | — | `whisperImageEnabled` | `false` |
 * | 首拍即索取 | `mutteringImmediate` | — | — | `false` |
 * | 展示时长 | `mutteringDuration` | — | — | 10000 |
 *
 * 开关缺省 `false` 是照抄上游语义：`pets[].whisperEnabled` 缺省关闭，注释写明原因是
 * 「后台碎碎念会顶掉正在跑的任务的 KV cache（与 DSH 多子代理同因）」。
 */
export function resolveMutteringPlan(input: MutteringPlanInput): MutteringPlan {
  const { config, entry } = input
  const intervalSec = clampIntervalSec(
    firstNumber(input.intervalSec, entry?.eventsRefreshSec?.whisper, config?.eventsRefreshSec?.whisper),
  )
  const duration = firstNumber(input.duration) ?? MUTTERING_DURATION_MS
  return {
    enabled: input.enabled ?? entry?.whisperEnabled ?? false,
    petId: entry?.id,
    prompt: firstString(input.prompt, config?.whisperPrompt) ?? '',
    intervalSec,
    intervalMs: intervalSec * 1000,
    image: input.image ?? config?.whisperImageEnabled ?? false,
    immediate: input.immediate ?? false,
    duration: duration > 0 ? duration : MUTTERING_DURATION_MS,
  }
}

/**
 * 抽一张表情包（`name` = `config.memes` 的键，`desc` = 描述）。
 *
 * 与 dsh-pet 一致：碎碎念**随机抽**而不是让模型选 —— 碎碎念没有上下文可选
 * （人设固定、无用户输入），交模型「选」只能盲选且多了幻觉风险
 * （`source/dsh-pet/dsh-pet/src/host/whisper.ts` 的设计注释）。
 */
export function pickMeme(
  memes: Record<string, string> | undefined,
  random: () => number = Math.random,
): { name: string, desc: string } | undefined {
  if (memes == null)
    return undefined
  const names = Object.keys(memes).filter(name => name.trim() !== '')
  const name = pick(names, undefined, random)
  return name === undefined ? undefined : { name, desc: memes[name] ?? '' }
}

/**
 * 抽一段碎碎念动画：`animations.events.whisper` **整池**等概率随机 1 段，避开当前
 * 正播的那段（避免连续重复）—— 与 dsh-pet `client/pet.ts` 的 `triggerWhisper` 一致。
 * 池为空返回 `undefined`，调用方回落 `waving`（Codex 图集就没有 whisper 行）。
 */
export function pickWhisperAnimation(
  animations: DshPetAnimations | undefined,
  previous?: string,
  random: () => number = Math.random,
): string | undefined {
  return pick(dshEventPool(animations, 'whisper'), previous, random)
}

function firstString(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '')
      return value
  }
  return undefined
}

function firstNumber(...values: (number | undefined)[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value))
      return value
  }
  return undefined
}

/** 周期钳制：缺失/非法回落缺省，且不小于 1 秒（dsh-pet `Math.max(1000, sec * 1000)`）。 */
function clampIntervalSec(value: number | undefined): number {
  if (value === undefined || value <= 0)
    return MUTTERING_FALLBACK_INTERVAL_SEC
  return Math.max(MUTTERING_MIN_INTERVAL_SEC, value)
}
