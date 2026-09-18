import type { PetRenderMotion } from './motion'

/**
 * 配置文件形状（`src/types/config.ts`）。
 *
 * 两条协议线并存，与参考实现一一对应：
 *
 * 1. `DshPetConfig` —— dsh-pet 的 `assets/config.jsonc` 协议（`source/dsh-pet`），
 *    资源是**逐动作的透明视频**（VP9-alpha `.webm`；macOS 走 HEVC-alpha `.mov`）。
 *    动作池条目 = 动画名 = 资源文件名主名，运行时拼 `uri/<动画名>.<ext>`。
 * 2. `CodexPetConfig` —— Codex 精灵图集协议（`source/codex-to-dsh-pet` 的 `pet.json`），
 *    资源是**一张 8 列的雪碧图**，每行一个动作，格子 192×208，9 行（v1）或 11 行
 *    （v2，多出 16 个鼠标追踪 look 格）。
 */

/** 角落（与 dsh-pet 的 `position.corner` 同义）。 */
export type PetCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/** 显示位置（dsh-pet 协议字段；组件只透传，不做宿主判定）。 */
export type PetDisplay = 'web' | 'desktop' | 'both' | 'none'

/** 一个可播放的动作：动画名（资源文件名主名）+ 可选参数覆盖。 */
export interface MoveSpec {
  name: string
  params?: Record<string, number>
}

/** 移动池（dsh-pet `animations.moves`）。 */
export interface MovesConfig {
  default: Record<string, number>
  actions: MoveSpec[]
}

/** 随机动作分类（带文字、镜像会颠倒的池标记 `noMirror`）。 */
export interface Category {
  id: string
  weight: number
  noMirror?: boolean
  actions: string[]
}

/** 事件档位槽位：单个动画名（固定播）或候选数组（触发时档内随机抽 1）。 */
export type EventSlot = string | string[]

/** 事件动画：事件名 → 档位数组（索引即档位；不进随机链，只由代码显式触发）。 */
export type PetEvents = Record<string, EventSlot[]>

/** 动画链顶层权重（`animationWeights`）。 */
export interface PetWeights {
  idle: number
  turn: number
  move: number
}

/** 动画名（= 资源文件名主名）或候选池（等概率抽一个）。 */
export type AnimationSlot = string | string[]

/** dsh-pet `animations` 段（受支持子集；未知字段原样保留不影响解析）。 */
export interface DshPetAnimations {
  /** 待机动画池 */
  idle?: string[]
  /** 转向动画池（每一项都应是「播完翻转朝向」的动画） */
  turn?: string[]
  /** 拖拽动画池（每次动作都必须是「被无形抓起悬空」的姿势） */
  drag?: string[]
  /** 点击回应动画池 */
  clicks?: string[]
  /** 移动池 */
  moves?: MovesConfig
  /** 随机动作分类池 */
  categories?: Category[]
  /** 事件动画：`workStatus` 六个档位与 Motion 的细分档一一对应 */
  events?: PetEvents
  /**
   * 动作 → 动画名/候选池 的显式覆盖（优先级高于上面各池）。
   *
   * 支持手势态 `dragging`：`{ "dragging": "被鼠标拖拽悬空反馈" }` 可以绕过 `drag` 池直接指定。
   */
  motions?: Partial<Record<PetRenderMotion, AnimationSlot>>
}

/** dsh-pet `pets[i]`（多开宠物条目；组件只取 `id` / `name` / `size` / `position`）。 */
export interface DshPetEntry {
  /** 唯一标识（素材目录/端点参数按它定位） */
  id: string
  /** 显示名（可重复） */
  name?: string
  /** 宽度 px（高 = 宽 × 9/16） */
  size?: number
  balanceEnabled?: boolean
  /**
   * 该条目是否启用碎碎念。
   *
   * 上游缺省 `false`，注释写明原因是「后台碎碎念会顶掉正在跑的任务的 KV cache
   * （与 DSH 多子代理同因）」—— 组件沿用同一缺省，`muttering` prop 可显式覆盖。
   */
  whisperEnabled?: boolean
  workStatusEnabled?: boolean
  /** 条目级事件刷新周期（秒；覆盖顶层 `eventsRefreshSec`） */
  eventsRefreshSec?: Record<string, number>
  display?: PetDisplay
  position?: { corner: PetCorner, marginX: number, marginY: number }
}

/** dsh-pet `physics` 段（拖拽抛掷手感；组件只透传与校验，不实现物理）。 */
export interface PhysicsParams {
  gravity: number
  restitution: number
  groundFriction: number
  ceilingBounce: boolean
  throwPower: number
  petCollision: boolean
}

/**
 * **dsh-pet 配置**：`config` 可以直接给这个对象，也可以给一个 `.jsonc` / `.json` 地址
 * （组件用 `fetch` 拉取并剥注释后解析，见 `src/utils/jsonc.ts`）。
 *
 * 最小可用配置（不需要 `animations`，直接显式给动作映射）：
 *
 * ```jsonc
 * { "motions": { "idle": "待机呼吸休闲", "working": ["忙碌点按", "写代码"] } }
 * ```
 */
export interface DshPetConfig {
  /**
   * 动作 → 动画名/候选池 的显式映射。优先级最高，可脱离 `animations` 单独使用。
   * 支持手势态 `dragging`。
   */
  motions?: Partial<Record<PetRenderMotion, AnimationSlot>>
  /** 动画池（dsh-pet 协议） */
  animations?: DshPetAnimations
  /** 动画链顶层权重（待机掷骰用） */
  animationWeights?: Partial<PetWeights>
  /** 事件刷新周期（秒） */
  eventsRefreshSec?: Record<string, number>
  /** 拖拽抛掷物理参数 */
  physics?: Partial<PhysicsParams>
  /** 宠物列表（多开；`petId` 缺省取第一个） */
  pets?: DshPetEntry[]
  /** 默认宽度 px（`size` prop 与 `pets[i].size` 都缺省时使用） */
  size?: number
  /**
   * 碎碎念人设（system 提示词，全局唯一，所有启用碎碎念的宠物共用）。
   *
   * 组件只把它交给宿主（`onMuttering(prompt, …)`），生成由宿主完成 —— 与 dsh-pet
   * 把 `whisperPrompt` 交给 host 的 `generateWhisper(ctx, system, meme)` 同分工。
   */
  whisperPrompt?: string
  /** 对话记忆轮数（本组件不读，保留字段用于协议完整性） */
  chatMemoryRounds?: number
  /**
   * 碎碎念是否配图（全局，缺省 `false`）。
   *
   * 开启后组件从 {@link DshPetConfig.memes} 随机抽 1 张，把 `{ name, desc }` 放进
   * `onMuttering` 的事件载荷（宿主据此拼提示词），并在气泡里展示宿主给出的图片 URL。
   */
  whisperImageEnabled?: boolean
  /** 对话是否配图（本组件不读，保留字段用于协议完整性） */
  chatImageEnabled?: boolean
  /**
   * 表情包映射：**键 = `assets/memes/<键>.png` 的文件名（不含扩展名），值 = 该图内容简述**
   * （dsh-pet `assets/config.jsonc` 的 `memes` 段）。
   *
   * 组件只用键来做「随机抽 1 张」并把 `{ name, desc }` 交给宿主；图片地址由宿主给
   * （组件不假设 `/dsh-pet-7340/pic/memes/<名>.png` 这条路径 —— 那是宿主路由的事）。
   */
  memes?: Record<string, string>
  /** 系统通知总开关（本组件不读，保留字段用于协议完整性） */
  notificationsEnabled?: boolean
}

/** Codex 图集的一行动作定义。 */
export interface CodexPetFrameSpec {
  /** 行号（0 起，与图集从上到下一致） */
  row: number
  /** 帧数（列数），缺省 8 */
  frames?: number
  /** 每帧时长 ms，缺省 140 */
  interval?: number
  /**
   * 逐帧时长 ms（可选，优先级高于 `interval`）：第 N 项 = 第 N 帧的停留时长。
   * 缺项/非法项回落 `interval`。用于「首末帧长停留」这类非匀速节奏
   * （对齐参考实现 `dsh-plugin-codex-pets` 的 `IDLE_DURATIONS`）。
   */
  durations?: number[]
  /** 是否循环，缺省按 Motion 语义 */
  loop?: boolean
}

/**
 * **Codex 精灵图配置**：可以直接给对象，也可以给 `pet.json` 的地址。
 *
 * 契约（`source/codex-to-dsh-pet/packages/dsh-codex-pet/src/registry.js`）：
 * 8 列 × 192×208 格子，9 行（v1）/ 11 行（v2，行 9-10 是 16 个 look 方向格）。
 */
export interface CodexPetConfig {
  id?: string
  displayName?: string
  description?: string
  /** 图集版本：1 = 9 行，2 = 11 行（多 look 格）。缺省按 `rows` 反推，再缺省 2。 */
  spriteVersionNumber?: 1 | 2
  /** 雪碧图相对路径（`pet.json` 字段；`uri` 缺省时按它拼接） */
  spritesheetPath?: string
  /** 列数，缺省 8 */
  columns?: number
  /** 格子宽，缺省 192（只影响宽高比） */
  frameWidth?: number
  /** 格子高，缺省 208（只影响宽高比） */
  frameHeight?: number
  /** 行数，缺省由 `spriteVersionNumber` 决定（v1=9 / v2=11） */
  rows?: number
  /** 显示宽度 px */
  size?: number
  /** 动作 → 行定义覆盖（数字 = 行号，使用默认帧数/帧率）；支持手势态 `dragging` */
  motions?: Partial<Record<PetRenderMotion, number | CodexPetFrameSpec>>
}

/** 任一配置文件形状。 */
export type PetConfig = DshPetConfig | CodexPetConfig

/** `config` prop：对象或（`.json` / `.jsonc`）地址。 */
export type PetConfigSource = string | PetConfig
