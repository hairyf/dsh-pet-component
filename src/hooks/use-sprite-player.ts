import type { RefObject } from 'react'
import type { CodexResolvedFrame } from '../config'
import { useEffect, useRef } from 'react'
import { CODEX_COLUMNS, CODEX_LOOK_START_ROW } from '../config'

/** 网格坐标 → 背景图百分比定位（`background-size` 固定为 `列数 × 100%`）。 */
function toPercent(index: number, count: number): number {
  return count <= 1 ? 0 : (index * 100) / (count - 1)
}

export interface UseSpritePlayerOptions {
  /** 精灵图元素 */
  elementRef: RefObject<HTMLElement | null>
  /** 当前动作的帧定义 */
  frame: CodexResolvedFrame
  /** 图集列数 */
  columns: number
  /** 图集行数 */
  rows: number
  /** 动作代次（变化即从头播） */
  revision: number
  reducedMotion: boolean
  /** look 格序号（`undefined` = 不追踪；追踪期间暂停帧推进） */
  lookIndex: number | undefined
  /** 一次性动作播完（含末帧停留）时回调 */
  onFinish?: () => void
}

/**
 * Codex 精灵图逐帧播放器 —— 按 `frame.interval` 用 `setTimeout` 链推进列号，
 * 通过 `background-position` 百分比切换格子（`background-size: 列数×100% 行数×100%`），
 * 因此与图集真实像素尺寸无关。
 *
 * 帧时长取值优先级：`durations[index]`（逐帧时长）> `interval`（匀速）。
 *
 * 三个语义与参考实现对齐：
 * - **look 格优先**：鼠标追踪期间不推进帧（`lookIndex !== undefined` 时只画 look 格）；
 * - **一次性动作停在末帧再收尾**：`loop: false` 时画完最后一帧后停留一个 `interval`
 *   再回调 `onFinish`，让「播完回 idle」不是硬切；提供 `durations` 时末帧时长本身
 *   即定格停留（对齐参考实现的 `lastDuration` 语义），不再额外多停一次。
 */
export function useSpritePlayer(options: UseSpritePlayerOptions): void {
  const { elementRef, frame, columns, rows, revision, reducedMotion, lookIndex, onFinish } = options
  // 帧定义拆成基本类型再进依赖：`frame` 对象每次渲染都可能是新引用（内联配置的场景），
  // 按对象当依赖会让帧计时器被反复重置 —— 依赖只认「帧定义真的变了」
  // `durations` 按内容比较（durationsKey），避免内联数组导致计时器反复重置
  const { row, frames, interval, loop } = frame
  const durations = frame.durations
  const durationsKey = durations?.join(',')

  const indexRef = useRef(0)
  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish

  // 换动作/重播 → 帧号归零（声明在前，先于播放 effect 执行）
  useEffect(() => {
    indexRef.current = 0
  }, [frames, revision, row])

  useEffect(() => {
    const el = elementRef.current
    if (el === null)
      return undefined

    const paint = (targetRow: number, column: number) => {
      el.style.backgroundPosition = `${toPercent(column, columns)}% ${toPercent(targetRow, rows)}%`
    }

    // 鼠标追踪：暂停帧推进，只画 look 格（v1 图集没有 look 行，调用方保证不传）
    if (lookIndex !== undefined) {
      paint(CODEX_LOOK_START_ROW + Math.floor(lookIndex / CODEX_COLUMNS), lookIndex % CODEX_COLUMNS)
      return undefined
    }

    const lastIndex = Math.max(0, frames - 1)
    /** 逐帧时长：取 `durations[index]`，缺项/非正数回落匀速 `interval`。 */
    const delayFor = (index: number): number => {
      const custom = durations?.[index]
      return typeof custom === 'number' && custom > 0 ? custom : interval
    }
    // 帧链任意时刻最多只有一个待触发的定时器（推进下一帧 或 末帧停留后收尾）
    let timer: number | undefined
    let disposed = false

    const schedule = (callback: () => void, delay: number) => {
      timer = window.setTimeout(callback, delay)
    }

    const finish = () => {
      if (!disposed)
        onFinishRef.current?.()
    }

    const step = () => {
      if (disposed)
        return
      const index = Math.min(indexRef.current, lastIndex)
      paint(row, index)

      // 减少动效：只画首帧，一次性动作按单帧时长收尾
      if (reducedMotion) {
        if (!loop)
          schedule(finish, delayFor(index))
        return
      }

      if (index >= lastIndex) {
        if (!loop) {
          // 停末帧再回落，避免硬切：有逐帧时长时末帧按自己的时长定格（lastDuration 语义，
          // 总时长 = durations 之和）；无 durations 保持旧行为——额外多停一个 interval
          schedule(finish, durations ? delayFor(index) : interval)
          return
        }
        indexRef.current = 0
      }
      else {
        indexRef.current = index + 1
      }
      // 按「刚画上去的帧」自己的时长等待再推进（首末帧长停留、中间帧快的小动作节奏）
      schedule(step, delayFor(index))
    }

    step()

    return () => {
      disposed = true
      if (timer !== undefined)
        window.clearTimeout(timer)
    }
  // `durationsKey` 是 `durations` 的内容签名：内联数组每次渲染都是新引用，
  // 按引用当依赖会让计时器反复重置；内容没变就无需重启播放
  // eslint-disable-next-line react/exhaustive-deps
  }, [columns, elementRef, frames, interval, durationsKey, lookIndex, loop, reducedMotion, revision, row, rows])
}
