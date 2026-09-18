import type { RefObject } from 'react'
import type { CodexResolvedFrame, IdleRollPick } from '../../src/config'
import type { Category, PetMutteringShowOptions, PetRef, PetRenderMotion, PetWeights } from '../../src/types'
import { useLayoutEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, renderHook } from 'vitest-browser-react'
import { useControllablePet } from '../../src/hooks/use-controllable-pet'
import { IDLE_ROLL_DELAY, useIdleRoll } from '../../src/hooks/use-idle-roll'
import { usePetBubbles } from '../../src/hooks/use-pet-bubbles'
import { useSpritePlayer } from '../../src/hooks/use-sprite-player'
import { useIsomorphicLayoutEffect } from '../../src/utils/react'

/**
 * 动作层 hook 的真浏览器行为 —— 精灵图逐帧播放、空闲掷骰、命令面转发、气泡接线，
 * 外加 `useIsomorphicLayoutEffect` 的浏览器分支。
 *
 * 时间相关的用例一律用假定时器（只假 `setTimeout` / `clearTimeout`，保住 React 调度用的
 * MessageChannel），每个 describe 自己 `useRealTimers()` 收尾；真解码 / 真 IndexedDB
 * 那部分在 `hooks-media.test.tsx`。
 */

describe('useIsomorphicLayoutEffect', () => {
  it('浏览器里就是 useLayoutEffect：挂载跑一次、卸载清理一次', async () => {
    const log: string[] = []
    const view = await renderHook(() => {
      useIsomorphicLayoutEffect(() => {
        log.push('mount')
        return () => {
          log.push('cleanup')
        }
      }, [])
      return null
    })

    expect(useIsomorphicLayoutEffect).toBe(useLayoutEffect)
    expect(log).toEqual(['mount'])

    await view.unmount()
    expect(log).toEqual(['mount', 'cleanup'])
  })
})

/** 精灵图元素上的百分比定位（`background-position: x% y%`）。 */
function position(element: HTMLElement): { x: number, y: number } {
  const [x = '0', y = '0'] = element.style.backgroundPosition.split(' ')
  return { x: Number.parseFloat(x), y: Number.parseFloat(y) }
}

interface SpriteHarnessProps {
  frame: CodexResolvedFrame
  columns?: number
  rows?: number
  revision?: number
  reducedMotion?: boolean
  lookIndex?: number
  onFinish?: () => void
}

function SpriteHarness({
  frame,
  columns = 8,
  rows = 11,
  revision = 0,
  reducedMotion = false,
  lookIndex,
  onFinish,
}: SpriteHarnessProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  useSpritePlayer({ elementRef: ref, frame, columns, rows, revision, reducedMotion, lookIndex, onFinish })
  return <div ref={ref} data-testid="sprite" />
}

/** 8 列 → 第 i 帧的 x 百分比；11 行 → 第 r 行的 y 百分比。 */
const X_PER_COLUMN = 100 / 7
const Y_PER_ROW = 10

describe('useSpritePlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('挂载即画首帧', async () => {
    const { container } = await render(
      <SpriteHarness frame={{ row: 0, frames: 4, interval: 1000, loop: true }} />,
    )
    const sprite = container.querySelector<HTMLElement>('[data-testid="sprite"]')
    expect(sprite).not.toBeNull()
    expect(position(sprite as HTMLElement)).toEqual({ x: 0, y: 0 })
  })

  it('按 interval 逐帧推进', async () => {
    const { container } = await render(
      <SpriteHarness frame={{ row: 0, frames: 4, interval: 1000, loop: true }} />,
    )
    const sprite = container.querySelector<HTMLElement>('[data-testid="sprite"]')
    expect(sprite).not.toBeNull()
    const element = sprite as HTMLElement

    vi.advanceTimersByTime(1000)
    expect(position(element).x).toBeCloseTo(X_PER_COLUMN, 3)

    vi.advanceTimersByTime(1000)
    expect(position(element).x).toBeCloseTo(X_PER_COLUMN * 2, 3)
  })

  it('循环动作播到末帧后回到第 0 帧', async () => {
    const { container } = await render(
      <SpriteHarness frame={{ row: 3, frames: 3, interval: 100, loop: true }} />,
    )
    const element = container.querySelector<HTMLElement>('[data-testid="sprite"]') as HTMLElement
    expect(position(element).y).toBeCloseTo(3 * Y_PER_ROW, 3)

    vi.advanceTimersByTime(100) // 第 1 帧
    vi.advanceTimersByTime(100) // 第 2 帧（末帧）
    expect(position(element).x).toBeCloseTo(X_PER_COLUMN * 2, 3)

    vi.advanceTimersByTime(100) // 回到第 0 帧
    expect(position(element).x).toBe(0)
  })

  it('revision 变化从头播', async () => {
    const frame: CodexResolvedFrame = { row: 0, frames: 4, interval: 1000, loop: true }
    const { container, rerender } = await render(<SpriteHarness frame={frame} revision={0} />)
    const element = container.querySelector<HTMLElement>('[data-testid="sprite"]') as HTMLElement

    vi.advanceTimersByTime(2000)
    expect(position(element).x).toBeCloseTo(X_PER_COLUMN * 2, 3)

    await rerender(<SpriteHarness frame={frame} revision={1} />)
    expect(position(element).x).toBe(0)
  })

  it('逐帧时长 durations 优先于 interval，缺项回落 interval', async () => {
    const { container } = await render(
      <SpriteHarness frame={{ row: 0, frames: 3, interval: 100, durations: [250, 50, 0], loop: true }} />,
    )
    const element = container.querySelector<HTMLElement>('[data-testid="sprite"]') as HTMLElement
    expect(position(element).x).toBe(0)

    vi.advanceTimersByTime(250) // 第 0 帧停留 250ms
    expect(position(element).x).toBeCloseTo(X_PER_COLUMN, 3)

    vi.advanceTimersByTime(50) // 第 1 帧只停 50ms
    expect(position(element).x).toBeCloseTo(X_PER_COLUMN * 2, 3)

    vi.advanceTimersByTime(99) // 第 2 帧时长 0 非法 → 回落 interval=100
    expect(position(element).x).toBeCloseTo(X_PER_COLUMN * 2, 3)
    vi.advanceTimersByTime(1)
    expect(position(element).x).toBe(0) // 循环回第 0 帧
  })

  it('一次性动作提供 durations 时：末帧时长即定格停留，不再额外多停', async () => {
    const onFinish = vi.fn()
    const { container } = await render(
      <SpriteHarness frame={{ row: 2, frames: 2, interval: 100, durations: [100, 300], loop: false }} onFinish={onFinish} />,
    )
    const element = container.querySelector<HTMLElement>('[data-testid="sprite"]') as HTMLElement

    vi.advanceTimersByTime(100) // 画第 1 帧（末帧）
    expect(position(element).x).toBeCloseTo(X_PER_COLUMN, 3)
    expect(onFinish).not.toHaveBeenCalled()

    vi.advanceTimersByTime(299) // 末帧按 durations 定格 300ms
    expect(onFinish).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('一次性动作停在末帧一个 interval 后收尾，且只回调一次', async () => {
    const onFinish = vi.fn()
    const { container } = await render(
      <SpriteHarness frame={{ row: 2, frames: 3, interval: 100, loop: false }} onFinish={onFinish} />,
    )
    const element = container.querySelector<HTMLElement>('[data-testid="sprite"]') as HTMLElement

    vi.advanceTimersByTime(100)
    expect(onFinish).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    // 末帧已画好，还在停留
    expect(position(element).x).toBeCloseTo(X_PER_COLUMN * 2, 3)
    expect(onFinish).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(onFinish).toHaveBeenCalledTimes(1)

    // 帧链到此为止，不会再回调
    vi.advanceTimersByTime(10_000)
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('reducedMotion：只画首帧，不推进', async () => {
    const { container } = await render(
      <SpriteHarness frame={{ row: 1, frames: 6, interval: 100, loop: true }} reducedMotion />,
    )
    const element = container.querySelector<HTMLElement>('[data-testid="sprite"]') as HTMLElement

    vi.advanceTimersByTime(1000)
    expect(position(element)).toEqual({ x: 0, y: Y_PER_ROW })
  })

  it('reducedMotion + 一次性动作：一个 interval 后收尾', async () => {
    const onFinish = vi.fn()
    await render(
      <SpriteHarness frame={{ row: 1, frames: 6, interval: 100, loop: false }} reducedMotion onFinish={onFinish} />,
    )

    vi.advanceTimersByTime(99)
    expect(onFinish).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('lookIndex 覆盖到 look 格并暂停帧推进', async () => {
    const { container } = await render(
      <SpriteHarness frame={{ row: 0, frames: 6, interval: 100, loop: true }} lookIndex={3} />,
    )
    const element = container.querySelector<HTMLElement>('[data-testid="sprite"]') as HTMLElement

    // look 格从第 9 行起，第 3 格 → 行 9、列 3
    expect(position(element).y).toBeCloseTo(9 * Y_PER_ROW, 3)
    expect(position(element).x).toBeCloseTo(X_PER_COLUMN * 3, 3)

    vi.advanceTimersByTime(1000)
    expect(position(element).x).toBeCloseTo(X_PER_COLUMN * 3, 3)
  })

  it('列数 / 行数为 1 时百分比恒为 0（不做除零）', async () => {
    const { container } = await render(
      <SpriteHarness frame={{ row: 0, frames: 3, interval: 100, loop: true }} columns={1} rows={1} />,
    )
    const element = container.querySelector<HTMLElement>('[data-testid="sprite"]') as HTMLElement

    vi.advanceTimersByTime(200)
    expect(position(element)).toEqual({ x: 0, y: 0 })
  })

  it('elementRef 还没挂上时什么都不做', async () => {
    const onFinish = vi.fn()
    function DetachedHarness() {
      const ref = useRef<HTMLDivElement | null>(null)
      useSpritePlayer({
        elementRef: ref,
        frame: { row: 0, frames: 3, interval: 100, loop: false },
        columns: 8,
        rows: 11,
        revision: 0,
        reducedMotion: false,
        lookIndex: undefined,
        onFinish,
      })
      return <span>没有精灵图</span>
    }

    const { container } = await render(<DetachedHarness />)
    vi.advanceTimersByTime(10_000)
    expect(container.textContent).toBe('没有精灵图')
    expect(onFinish).not.toHaveBeenCalled()
  })
})

const WEIGHTS_TURN_ONLY: PetWeights = { idle: 0, turn: 100, move: 0 }
const TURN_POOL = ['转身甲']
const IDLE_POOL = ['待机甲']
const CATEGORIES: Category[] = [{ id: 'flavor', weight: 1, actions: ['风味甲'] }]

interface IdleRollHarnessOptions {
  onPick: (pick: IdleRollPick) => void
  random?: () => number
  weights?: PetWeights
  enabled?: boolean
  active?: boolean
  reducedMotion?: boolean
  turnPool?: readonly string[]
  idlePool?: readonly string[]
  categories?: readonly Category[]
  current?: string
  delay?: readonly [number, number]
}

function renderIdleRoll(options: IdleRollHarnessOptions) {
  return renderHook(() => useIdleRoll({
    enabled: true,
    active: true,
    weights: WEIGHTS_TURN_ONLY,
    turnPool: TURN_POOL,
    idlePool: IDLE_POOL,
    categories: CATEGORIES,
    facing: 'left',
    reducedMotion: false,
    delay: [10, 10],
    ...options,
  }))
}

describe('useIdleRoll', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('enabled / active / reducedMotion / 空池 任一不满足就不排定时器', async () => {
    const cases: IdleRollHarnessOptions[] = [
      { onPick: vi.fn(), enabled: false },
      { onPick: vi.fn(), active: false },
      { onPick: vi.fn(), reducedMotion: true },
      { onPick: vi.fn(), turnPool: [], categories: [] },
    ]

    for (const options of cases) {
      const view = await renderIdleRoll(options)
      await view.act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(options.onPick).not.toHaveBeenCalled()
      await view.unmount()
    }
  })

  it('纯待机到点从 turn 池抽一个插播', async () => {
    const onPick = vi.fn()
    const view = await renderIdleRoll({ onPick, random: () => 0 })

    await view.act(() => {
      vi.advanceTimersByTime(10)
    })
    expect(onPick).toHaveBeenCalledWith({ name: '转身甲', motion: 'turn' })
  })

  it('不注入随机源时用 Math.random（权重 100 的档位必命中）', async () => {
    const onPick = vi.fn()
    const view = await renderIdleRoll({ onPick })

    await view.act(() => {
      vi.advanceTimersByTime(10)
    })
    expect(onPick).toHaveBeenCalledWith({ name: '转身甲', motion: 'turn' })
  })

  it('抽到与当前重复的动画算未命中：继续待机并重排下一次', async () => {
    const onPick = vi.fn()
    // 权重全给 turn，池里只有「正在播的那一个」→ 每拍都抽中同一个名字 → null → 重排
    const rolls = vi.fn(() => 0)
    const view = await renderIdleRoll({ onPick, random: rolls, current: '转身甲' })

    await view.act(() => {
      vi.advanceTimersByTime(30)
    })
    expect(onPick).not.toHaveBeenCalled()
    // 每一拍都重新掷过骰（证明返回 null 之后确实又排了定时器，没有停在待机）
    expect(rolls.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  it('turn 池为空但分类池非空：一直未命中并继续重排', async () => {
    const onPick = vi.fn()
    const rolls = vi.fn(() => 0)
    const view = await renderIdleRoll({ onPick, random: rolls, turnPool: [] })

    await view.act(() => {
      vi.advanceTimersByTime(30)
    })
    expect(onPick).not.toHaveBeenCalled()
    expect(rolls.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  it('权重不指向任何固定档位时从分类池抽风味动作', async () => {
    const onPick = vi.fn()
    // 三个权重都是 0 → total <= 0 → 归入 action（分类池）
    const view = await renderIdleRoll({ onPick, random: () => 0, weights: { idle: 0, turn: 0, move: 0 } })

    await view.act(() => {
      vi.advanceTimersByTime(10)
    })
    expect(onPick).toHaveBeenCalledWith({ name: '风味甲', motion: 'waving' })
  })

  it('缺省间隔是 20s~45s', async () => {
    expect(IDLE_ROLL_DELAY).toEqual([20_000, 45_000])

    const onPick = vi.fn()
    const view = await renderIdleRoll({ onPick, random: () => 0, delay: undefined })

    await view.act(() => {
      vi.advanceTimersByTime(19_999)
    })
    expect(onPick).not.toHaveBeenCalled()

    await view.act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('卸载后定时器不再触发', async () => {
    const onPick = vi.fn()
    const view = await renderIdleRoll({ onPick, random: () => 0 })

    await view.unmount()
    vi.advanceTimersByTime(1000)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('delay 上界小于下界时按 0 跨度处理', async () => {
    const onPick = vi.fn()
    const view = await renderIdleRoll({ onPick, random: () => 0.5, delay: [30, 10] })

    await view.act(() => {
      vi.advanceTimersByTime(29)
    })
    expect(onPick).not.toHaveBeenCalled()

    await view.act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onPick).toHaveBeenCalledTimes(1)
  })
})

interface FakePet {
  pet: PetRef
  motion: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  showBubble: ReturnType<typeof vi.fn>
  closeBubble: ReturnType<typeof vi.fn>
  clearBubbles: ReturnType<typeof vi.fn>
  showMuttering: ReturnType<typeof vi.fn>
  requestMuttering: ReturnType<typeof vi.fn>
}

/** 一台记录调用的假桌宠实例（`useControllablePet` 只做转发，不是真渲染器）。 */
function makeFakePet(current: PetRenderMotion = 'thinking'): FakePet {
  const motion = vi.fn()
  const clear = vi.fn()
  const showBubble = vi.fn(() => 'bubble-1')
  const closeBubble = vi.fn()
  const clearBubbles = vi.fn()
  const showMuttering = vi.fn()
  const requestMuttering = vi.fn()

  const pet: PetRef = {
    motion,
    clear,
    get current() {
      return current
    },
    bubble: Object.assign(showBubble, { close: closeBubble, clear: clearBubbles }),
    muttering: Object.assign(showMuttering, { request: requestMuttering }),
  }

  return { pet, motion, clear, showBubble, closeBubble, clearBubbles, showMuttering, requestMuttering }
}

describe('useControllablePet', () => {
  it('motion / clear / current 转发到组件实例', async () => {
    const fake = makeFakePet('working')
    const ref: RefObject<PetRef | null> = { current: fake.pet }
    const view = await renderHook(() => useControllablePet(ref))

    view.result.current.motion({ type: 'thinking', loop: true })
    expect(fake.motion).toHaveBeenCalledWith({ type: 'thinking', loop: true })

    view.result.current.clear()
    expect(fake.clear).toHaveBeenCalledTimes(1)

    expect(view.result.current.current).toBe('working')
  })

  it('气泡命令转发：调用 + close / clear', async () => {
    const fake = makeFakePet()
    const ref: RefObject<PetRef | null> = { current: fake.pet }
    const view = await renderHook(() => useControllablePet(ref))

    expect(view.result.current.bubble({ id: 's1', title: '会话', loading: true })).toBe('bubble-1')
    expect(fake.showBubble).toHaveBeenCalledWith({ id: 's1', title: '会话', loading: true })

    view.result.current.bubble.close('s1')
    expect(fake.closeBubble).toHaveBeenCalledWith('s1')

    view.result.current.bubble.close()
    expect(fake.closeBubble).toHaveBeenLastCalledWith(undefined)

    view.result.current.bubble.clear()
    expect(fake.clearBubbles).toHaveBeenCalledTimes(1)
  })

  it('碎碎念命令转发：展示 + request', async () => {
    const fake = makeFakePet()
    const ref: RefObject<PetRef | null> = { current: fake.pet }
    const view = await renderHook(() => useControllablePet(ref))

    const options: PetMutteringShowOptions = { duration: 3000 }
    view.result.current.muttering('今天风好大', options)
    expect(fake.showMuttering).toHaveBeenCalledWith('今天风好大', options)

    view.result.current.muttering.request()
    expect(fake.requestMuttering).toHaveBeenCalledTimes(1)
  })

  it('ref 还没挂上（current 为 null）时全是安全空操作', async () => {
    const ref: RefObject<PetRef | null> = { current: null }
    const view = await renderHook(() => useControllablePet(ref))

    expect(() => view.result.current.motion('idle')).not.toThrow()
    expect(() => view.result.current.clear()).not.toThrow()
    expect(view.result.current.current).toBe('idle')
    expect(view.result.current.bubble({ title: 'x' })).toBe('')
    expect(() => view.result.current.bubble.close()).not.toThrow()
    expect(() => view.result.current.bubble.clear()).not.toThrow()
    expect(() => view.result.current.muttering('x')).not.toThrow()
    expect(() => view.result.current.muttering.request()).not.toThrow()
  })

  it('不传 ref 也能用（可选参数）', async () => {
    const view = await renderHook(() => useControllablePet())

    expect(view.result.current.current).toBe('idle')
    expect(view.result.current.bubble({ title: 'x' })).toBe('')
    expect(() => view.result.current.motion('idle')).not.toThrow()
    expect(() => view.result.current.muttering.request()).not.toThrow()
  })

  it('命令面引用稳定，可安全放进依赖数组', async () => {
    const fake = makeFakePet()
    const ref: RefObject<PetRef | null> = { current: fake.pet }
    const view = await renderHook(() => useControllablePet(ref))
    const handle = view.result.current

    await view.rerender()
    expect(view.result.current).toBe(handle)
  })
})

describe('usePetBubbles', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('show / update / close / clear 接通可见层与聚合动作', async () => {
    const onShow = vi.fn()
    const onUpdate = vi.fn()
    const view = await renderHook(() => usePetBubbles({ onShow, onUpdate }))

    let key = ''
    await view.act(() => {
      key = view.result.current.handle({ id: 's1', title: '会话', description: '处理中', loading: true, motion: 'thinking' })
    })
    expect(key).toBe('s1')
    expect(view.result.current.bubbles.map(bubble => bubble.id)).toEqual(['s1'])
    expect(view.result.current.bubbles[0]?.duration).toBe(0)
    expect(onShow).toHaveBeenCalledTimes(1)

    // 聚合动作有 100ms 合并窗口
    await view.act(() => {
      vi.advanceTimersByTime(120)
    })
    expect(view.result.current.motion).toBe('thinking')

    await view.act(() => {
      view.result.current.handle({ id: 's1', description: '完成', motion: 'success' })
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(view.result.current.bubbles[0]?.description).toBe('完成')

    await view.act(() => {
      view.result.current.handle.close('s1')
    })
    expect(view.result.current.bubbles).toHaveLength(0)

    await view.act(() => {
      view.result.current.handle({ id: 's2', title: '第二条', motion: 'working' })
      view.result.current.handle({ id: 's3', title: '第三条', motion: 'waiting' })
    })
    expect(view.result.current.bubbles).toHaveLength(2)

    await view.act(() => {
      view.result.current.handle.clear()
    })
    expect(view.result.current.bubbles).toHaveLength(0)

    await view.act(() => {
      vi.advanceTimersByTime(120)
    })
    expect(view.result.current.motion).toBeUndefined()
  })

  it('max 透传给状态机（每个方向同时可见上限）', async () => {
    const view = await renderHook(() => usePetBubbles({ max: 1 }))

    await view.act(() => {
      view.result.current.handle({ id: 'a', title: 'A' })
      view.result.current.handle({ id: 'b', title: 'B' })
    })
    expect(view.result.current.bubbles.map(bubble => bubble.id)).toEqual(['b'])
  })

  it('不传回调也能用，handle 引用稳定', async () => {
    const view = await renderHook(() => usePetBubbles())
    const handle = view.result.current.handle

    await view.act(() => {
      view.result.current.handle({ id: 'a', title: 'A' })
    })
    expect(view.result.current.bubbles.map(bubble => bubble.id)).toEqual(['a'])

    await view.rerender()
    expect(view.result.current.handle).toBe(handle)
  })

  it('卸载时 dispose 掉状态机的全部定时器', async () => {
    const view = await renderHook(() => usePetBubbles())

    await view.act(() => {
      view.result.current.handle({ id: 's1', title: '会话', motion: 'success' })
    })
    // 自动收起计时器 + 聚合合并窗口都还挂着
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    await view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
