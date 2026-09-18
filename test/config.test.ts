import type { DshPetConfig, Motion } from '../src/types'
import { describe, expect, it } from 'vitest'
// 内部单测直接打实现模块（公开入口只剩 Pet / useConfig / useControllablePet）
import {
  COARSE_MOTION_ALIAS,
  CODEX_ACTIONS,
  CODEX_DEFAULT_SIZE,
  CODEX_MOTION_ACTION,
  CODEX_ROWS_V1,
  CODEX_ROWS_V2,
  detectPetKind,
  dshBalanceTier,
  dshCategoryPool,
  dshDragPool,
  dshEventPool,
  dshMotionPool,
  dshMovePool,
  isCodexLookSupported,
  isCodexPetConfig,
  isDshPetConfig,
  isLoopingMotion,
  LOOPING_MOTIONS,
  normalizeMotion,
  PET_BASE_WIDTH,
  pick,
  pickCategoryAction,
  pickIdleRoll,
  pickWeightedCategory,
  resolveCodexFrame,
  resolveCodexRows,
  resolveDshAnimation,
  resolveLookIndex,
  resolvePetSize,
  resolvePhysics,
  resolveWeights,
  rollKind,
  selectPetEntry,
  slotToPool,
  supportsIdleRoll,
} from '../src/config'
import { shouldReloadAnimation } from '../src/hooks/use-video-crossfade'
import { MOTIONS } from '../src/types/motion'
import { normalizeExtension, resolveAssetUrl, resolvePlatformValue } from '../src/utils/env'
import { inferMediaType } from '../src/utils/media-cache'
import { createSeededRandom } from '../src/utils/random'

/* -------------------------------------------------------------------------- */
/* 夹具：dsh-pet 配置（与 assets/config.jsonc 的字段形状一致）                   */
/* -------------------------------------------------------------------------- */

const config: DshPetConfig = {
  pets: [
    { id: 'main', name: '蓝毛小女仆', size: 462 },
    { id: 'second', name: '第二只', size: 300 },
  ],
  animationWeights: { idle: 10, turn: 5, move: 5 },
  animations: {
    idle: ['待机呼吸休闲'],
    turn: ['东张西望'],
    drag: ['被鼠标拖拽悬空反馈'],
    clicks: ['点击回应-开心跃动', '点击回应-元气挥手'],
    moves: {
      default: { minDist: 60, maxDist: 240 },
      actions: [{ name: '螃蟹走路' }, { name: '原地漂浮踏步' }],
    },
    categories: [
      { id: '小动作', weight: 20, actions: ['悠闲哼歌', '写代码'] },
      { id: '文字', weight: 10, noMirror: true, actions: ['深度思考碎碎念'] },
    ],
    events: {
      // 档位（索引即档位；值可以是单个动画名或候选数组）
      workStatus: [
        ['工作状态-思考冒泡'],
        ['工作状态-忙碌点按'],
        '工作状态-清点归档',
        ['工作状态-原地踱步张望'],
        ['工作状态-雀跃庆祝'],
        ['工作状态-垂头叹气冒汗'],
      ],
      balance: [
        '余额-钱袋满溢',
        '余额-金袋叮当',
        '余额-钱袋如常',
        '余额-数金皱眉',
        '余额-袋空如洗',
        '余额-分文不剩',
      ],
      // 非档位事件：单档多候选，到点等概率抽 1
      whisper: ['碎碎念-擦桌碎碎念', '碎碎念-发呆碎碎念', '碎碎念-对屏碎碎念'],
    },
  },
}

const alwaysZero = () => 0
const alwaysLast = () => 0.999999

/* -------------------------------------------------------------------------- */

describe('动作语义', () => {
  it('mOTIONS 覆盖 14 个动作且不重复', () => {
    expect(MOTIONS).toHaveLength(14)
    expect(new Set(MOTIONS).size).toBe(14)
  })

  it('循环档与参考实现一致，手势态 dragging 恒为循环', () => {
    expect([...LOOPING_MOTIONS].sort()).toEqual(
      ['idle', 'moving-left', 'moving-right', 'result', 'running', 'thinking', 'waiting', 'working'].sort(),
    )
    // 终态档与风味动作为一次性
    for (const motion of ['turn', 'waving', 'review', 'failed', 'success', 'error'] as Motion[])
      expect(isLoopingMotion(motion)).toBe(false)
    // 手势态：拖拽期间一直悬空浮动
    expect(isLoopingMotion('dragging')).toBe(true)
  })

  it('旧粗态映射到细分档位', () => {
    expect(COARSE_MOTION_ALIAS.running).toBe('working')
    expect(COARSE_MOTION_ALIAS.review).toBe('result')
    expect(COARSE_MOTION_ALIAS.failed).toBe('error')
  })

  it('别名归一化（dragging 归一为手势态本身，而不是某个方向）', () => {
    expect(normalizeMotion('running-right')).toBe('moving-right')
    expect(normalizeMotion('run-left')).toBe('moving-left')
    expect(normalizeMotion('wave')).toBe('waving')
    expect(normalizeMotion('idle')).toBe('idle')
    expect(normalizeMotion('dragging')).toBe('dragging')
    expect(normalizeMotion('drag')).toBe('dragging')
    expect(normalizeMotion('nope')).toBeNull()
  })
})

describe('拾取器', () => {
  it('pick 排除后池空则退回原池（不返回 undefined）', () => {
    expect(pick(['only'], 'only', alwaysZero)).toBe('only')
    expect(pick([], undefined, alwaysZero)).toBeUndefined()
    expect(pick(['a', 'b'], 'a', alwaysZero)).toBe('b')
  })

  it('rollKind 按权重切档：idle 10 / turn 5 / move 5 / 其余 action', () => {
    const weights = { idle: 10, turn: 5, move: 5 }
    expect(rollKind(0, weights)).toBe('idle')
    expect(rollKind(0.099, weights)).toBe('idle')
    expect(rollKind(0.1, weights)).toBe('turn')
    expect(rollKind(0.149, weights)).toBe('turn')
    expect(rollKind(0.15, weights)).toBe('move')
    expect(rollKind(0.199, weights)).toBe('move')
    expect(rollKind(0.2, weights)).toBe('action')
    expect(rollKind(0.99, weights)).toBe('action')
  })

  it('rollKind 权重全零时全归 action', () => {
    expect(rollKind(0, { idle: 0, turn: 0, move: 0 })).toBe('action')
  })

  it('pickWeightedCategory 在镜像时排除 noMirror 分类', () => {
    const categories = config.animations!.categories!
    expect(pickWeightedCategory(categories, 'left', alwaysLast)?.id).toBe('文字')
    expect(pickWeightedCategory(categories, 'right', alwaysLast)?.id).toBe('小动作')
    expect(pickWeightedCategory([], 'left', alwaysZero)).toBeNull()
  })

  it('pickCategoryAction 无分类时回退 idle 池', () => {
    expect(pickCategoryAction([], ['待机呼吸休闲'], 'left', undefined, alwaysZero))
      .toEqual({ id: 'FALLBACK', name: '待机呼吸休闲' })
    expect(pickCategoryAction(config.animations!.categories!, [], 'left', undefined, alwaysZero).id)
      .toBe('小动作')
  })

  it('pickIdleRoll：turn 命中 → turn 池；action 命中 → 分类池；idle/move 命中 → null', () => {
    const base = {
      weights: { idle: 10, turn: 5, move: 5 },
      turnPool: ['东张西望'],
      idlePool: ['待机呼吸休闲'],
      categories: config.animations!.categories!,
      facing: 'left' as const,
    }
    expect(pickIdleRoll({ ...base, random: () => 0.12 })).toEqual({ name: '东张西望', motion: 'turn' })
    expect(pickIdleRoll({ ...base, random: () => 0.17 })).toBeNull() // move 档不漫游
    expect(pickIdleRoll({ ...base, random: () => 0.05 })).toBeNull() // idle 档继续待机
    const action = pickIdleRoll({ ...base, random: () => 0.5 })
    expect(action?.motion).toBe('waving')
    expect(config.animations!.categories!.flatMap(category => category.actions)).toContain(action?.name)
  })

  it('pickIdleRoll 不与当前动画重复', () => {
    const picked = pickIdleRoll({
      weights: { idle: 0, turn: 100, move: 0 },
      turnPool: ['东张西望'],
      idlePool: [],
      categories: [],
      facing: 'left',
      current: '东张西望',
      random: alwaysZero,
    })
    expect(picked).toBeNull()
  })
})

describe('dsh-pet 动作 → 动画名', () => {
  it('协议池映射：idle / turn / waving / workStatus 档位', () => {
    expect(dshMotionPool('idle', config.animations)).toEqual(['待机呼吸休闲'])
    expect(dshMotionPool('turn', config.animations)).toEqual(['东张西望'])
    expect(dshMotionPool('waving', config.animations)).toEqual(['点击回应-开心跃动', '点击回应-元气挥手'])
    expect(dshMotionPool('thinking', config.animations)).toEqual(['工作状态-思考冒泡'])
    expect(dshMotionPool('working', config.animations)).toEqual(['工作状态-忙碌点按'])
    expect(dshMotionPool('result', config.animations)).toEqual(['工作状态-清点归档'])
    expect(dshMotionPool('waiting', config.animations)).toEqual(['工作状态-原地踱步张望'])
    expect(dshMotionPool('success', config.animations)).toEqual(['工作状态-雀跃庆祝'])
    expect(dshMotionPool('error', config.animations)).toEqual(['工作状态-垂头叹气冒汗'])
  })

  it('拖动走 drag 悬浮池，左右移动走 moves 走路池（两者互不串台）', () => {
    // 手势态：被无形抓起悬空
    expect(dshMotionPool('dragging', config.animations)).toEqual(['被鼠标拖拽悬空反馈'])
    expect(dshDragPool(config.animations)).toEqual(['被鼠标拖拽悬空反馈'])
    // 方向档：走路素材（宿主自己驱动移动 / 纯手动触发时用）
    expect(dshMotionPool('moving-left', config.animations)).toEqual(['螃蟹走路', '原地漂浮踏步'])
    expect(dshMotionPool('moving-right', config.animations)).toEqual(['螃蟹走路', '原地漂浮踏步'])
    expect(dshMovePool(config.animations)).toEqual(['螃蟹走路', '原地漂浮踏步'])
    // 反向断言：拖拽池与走路池没有交集
    for (const name of dshDragPool(config.animations))
      expect(dshMovePool(config.animations)).not.toContain(name)
  })

  it('没有 drag 池时拖动回落到 idle 池，而不是去播走路动画', () => {
    const noDrag: DshPetConfig = {
      animations: {
        idle: ['待机'],
        moves: { default: {}, actions: [{ name: '螃蟹走路' }] },
      },
    }
    expect(dshMotionPool('dragging', noDrag.animations)).toEqual([])
    expect(resolveDshAnimation({ motion: 'dragging', config: noDrag, random: alwaysZero })).toBe('待机')
    // 但左右移动仍然拿得到走路池
    expect(resolveDshAnimation({ motion: 'moving-left', config: noDrag, random: alwaysZero })).toBe('螃蟹走路')
  })

  it('显式 motions.dragging 可以覆盖悬浮动画', () => {
    const explicit: DshPetConfig = {
      animations: { idle: ['待机'], drag: ['默认悬浮'] },
      motions: { dragging: '自定义悬浮' },
    }
    expect(resolveDshAnimation({ motion: 'dragging', config: explicit, random: alwaysZero })).toBe('自定义悬浮')
  })

  it('旧粗态借道细分档位', () => {
    expect(dshMotionPool('running', config.animations)).toEqual(['工作状态-忙碌点按'])
    expect(dshMotionPool('review', config.animations)).toEqual(['工作状态-清点归档'])
    expect(dshMotionPool('failed', config.animations)).toEqual(['工作状态-垂头叹气冒汗'])
  })

  it('池映射覆盖协议 animations 段的全部字段', () => {
    // 动作槽
    expect(dshMotionPool('idle', config.animations)).toEqual(['待机呼吸休闲'])
    expect(dshMotionPool('turn', config.animations)).toEqual(['东张西望'])
    expect(dshMotionPool('dragging', config.animations)).toEqual(['被鼠标拖拽悬空反馈'])
    expect(dshMotionPool('moving-left', config.animations)).toEqual(['螃蟹走路', '原地漂浮踏步'])
    expect(dshMotionPool('moving-right', config.animations)).toEqual(['螃蟹走路', '原地漂浮踏步'])
    expect(dshMotionPool('waving', config.animations)).toEqual(['点击回应-开心跃动', '点击回应-元气挥手'])
    // 分类池（摊平所有分类）
    expect(dshMotionPool('categories', config.animations)).toEqual(['悠闲哼歌', '写代码', '深度思考碎碎念'])
    expect(dshCategoryPool(config.animations)).toEqual(['悠闲哼歌', '写代码', '深度思考碎碎念'])
    // 事件槽：整池摊平（whisper 就是「到点从整池随机抽一段」）
    expect(dshMotionPool('events.balance', config.animations)).toEqual([
      '余额-钱袋满溢',
      '余额-金袋叮当',
      '余额-钱袋如常',
      '余额-数金皱眉',
      '余额-袋空如洗',
      '余额-分文不剩',
    ])
    expect(dshMotionPool('events.whisper', config.animations)).toEqual(['碎碎念-擦桌碎碎念', '碎碎念-发呆碎碎念', '碎碎念-对屏碎碎念'])
    expect(dshMotionPool('events.workStatus', config.animations)).toEqual([
      '工作状态-思考冒泡',
      '工作状态-忙碌点按',
      '工作状态-清点归档',
      '工作状态-原地踱步张望',
      '工作状态-雀跃庆祝',
      '工作状态-垂头叹气冒汗',
    ])
    // 给档位就是该档的候选池（索引即档位）
    expect(dshEventPool(config.animations, 'balance', 5)).toEqual(['余额-分文不剩'])
    expect(dshEventPool(config.animations, 'workStatus', 3)).toEqual(['工作状态-原地踱步张望'])
    // 未知事件 / 越界档位 / 空配置都不炸
    expect(dshEventPool(config.animations, 'nope')).toEqual([])
    expect(dshEventPool(config.animations, 'workStatus', 99)).toEqual([])
    expect(dshEventPool(undefined, 'balance')).toEqual([])
    expect(dshMotionPool('categories', undefined)).toEqual([])
  })

  it('余额档位与协议注释一致（已用百分比 → 0..4，恰好 100 走格外档 5）', () => {
    expect(dshBalanceTier(0)).toBe(0)
    expect(dshBalanceTier(19.9)).toBe(0)
    expect(dshBalanceTier(20)).toBe(1)
    expect(dshBalanceTier(59)).toBe(2)
    expect(dshBalanceTier(99)).toBe(4)
    expect(dshBalanceTier(100)).toBe(5)
    expect(dshBalanceTier(150)).toBe(5)
    expect(dshBalanceTier(-1)).toBe(0)
    expect(dshBalanceTier(Number.NaN)).toBe(0)
  })

  it('slotToPool 处理字符串 / 数组 / 空值', () => {
    expect(slotToPool('a')).toEqual(['a'])
    expect(slotToPool(['a', 'b'])).toEqual(['a', 'b'])
    expect(slotToPool(['a', ''])).toEqual(['a'])
    expect(slotToPool('')).toEqual([])
    expect(slotToPool(undefined)).toEqual([])
  })

  it('resolveDshAnimation 走协议池，并在缺失时回落到 idle 池', () => {
    expect(resolveDshAnimation({ motion: 'idle', config, random: alwaysZero })).toBe('待机呼吸休闲')
    expect(resolveDshAnimation({ motion: 'working', config, random: alwaysZero })).toBe('工作状态-忙碌点按')

    const noWorkStatus: DshPetConfig = { animations: { idle: ['待机'] } }
    expect(resolveDshAnimation({ motion: 'working', config: noWorkStatus, random: alwaysZero })).toBe('待机')
  })

  it('显式 motions 映射优先级最高（顶层与 animations 段内都支持）', () => {
    const explicit: DshPetConfig = {
      ...config,
      motions: { working: '自定义干活' },
      animations: { ...config.animations, motions: { idle: '自定义待机' } },
    }
    expect(resolveDshAnimation({ motion: 'working', config: explicit, random: alwaysZero })).toBe('自定义干活')
    expect(resolveDshAnimation({ motion: 'idle', config: explicit, random: alwaysZero })).toBe('自定义待机')
  })

  it('显式映射支持候选数组（等概率抽）', () => {
    const slot: DshPetConfig = { motions: { waving: ['a', 'b'] } }
    expect(resolveDshAnimation({ motion: 'waving', config: slot, random: alwaysZero })).toBe('a')
    expect(resolveDshAnimation({ motion: 'waving', config: slot, random: alwaysLast })).toBe('b')
  })

  it('种子随机源可复现（同一 revision 抽到同一段）', () => {
    const pool: DshPetConfig = { motions: { waving: ['a', 'b', 'c', 'd'] } }
    const first = resolveDshAnimation({ motion: 'waving', config: pool, random: createSeededRandom(7) })
    const second = resolveDshAnimation({ motion: 'waving', config: pool, random: createSeededRandom(7) })
    expect(first).toBe(second)
    expect(first).not.toBe('')
  })

  it('配置缺失时返回 null（不静默播错资源）', () => {
    expect(resolveDshAnimation({ motion: 'idle', config: null })).toBeNull()
    expect(resolveDshAnimation({ motion: 'idle', config: {} })).toBeNull()
    expect(resolveDshAnimation({ motion: 'success', config: { animations: { idle: ['待机'] } } })).toBe('待机')
  })
})

describe('codex 图集', () => {
  it('行数：v1 = 9 / v2 = 11 / 显式优先', () => {
    expect(resolveCodexRows({ spriteVersionNumber: 1 })).toBe(CODEX_ROWS_V1)
    expect(resolveCodexRows({ spriteVersionNumber: 2 })).toBe(CODEX_ROWS_V2)
    expect(resolveCodexRows(null)).toBe(CODEX_ROWS_V2)
    expect(resolveCodexRows({ rows: 9 })).toBe(9)
    expect(isCodexLookSupported({ spriteVersionNumber: 1 })).toBe(false)
    expect(isCodexLookSupported({ spriteVersionNumber: 2 })).toBe(true)
    expect(isCodexLookSupported({ rows: 12 })).toBe(true)
  })

  it('14 个动作 + 手势态都有落行，细分档近似映射与参考实现一致', () => {
    for (const motion of MOTIONS)
      expect(CODEX_ACTIONS[CODEX_MOTION_ACTION[motion]]).toBeDefined()

    expect(CODEX_MOTION_ACTION.thinking).toBe('waiting')
    expect(CODEX_MOTION_ACTION.working).toBe('running')
    expect(CODEX_MOTION_ACTION.result).toBe('review')
    expect(CODEX_MOTION_ACTION.success).toBe('waving')
    expect(CODEX_MOTION_ACTION.error).toBe('failed')
    expect(CODEX_MOTION_ACTION.failed).toBe('failed')
    expect(CODEX_MOTION_ACTION.turn).toBe('movingRight')
    expect(CODEX_MOTION_ACTION['moving-left']).toBe('movingLeft')
    // 图集没有专门的拖拽行：手势态回落右行（参考实现 spriteAction 的 dragging 回落）
    expect(CODEX_MOTION_ACTION.dragging).toBe('movingRight')
  })

  it('codex 拖动靠左右行走行表达（与 dsh-pet 的悬浮相反）', () => {
    expect(resolveCodexFrame('dragging', null)).toMatchObject({ row: 1, loop: true })
    // 方向档仍是各自的行走行
    expect(resolveCodexFrame('moving-left', null)).toMatchObject({ row: 2, loop: true })
    expect(resolveCodexFrame('moving-right', null)).toMatchObject({ row: 1, loop: true })
    // 组件层：dragging 时把 motion 的方向带进来（见 CodexPet 的 renderMotion 规则）
    expect(resolveCodexFrame('moving-left', null).row).not.toBe(resolveCodexFrame('dragging', null).row)
  })

  it('resolveCodexFrame 取内置行 + 循环语义', () => {
    expect(resolveCodexFrame('idle', null)).toMatchObject({ row: 0, frames: 6, interval: 160, loop: true })
    // idle 带逐帧时长（对齐参考实现 dsh-plugin-codex-pets 的 IDLE_DURATIONS）
    expect(resolveCodexFrame('idle', null).durations).toEqual([280, 110, 110, 140, 140, 320])
    // 其余行保持匀速，无逐帧时长
    expect(resolveCodexFrame('waving', null)).toMatchObject({ row: 3, frames: 4, loop: false })
    expect(resolveCodexFrame('waving', null).durations).toBeUndefined()
    expect(resolveCodexFrame('working', null)).toMatchObject({ row: 7, loop: true })
    expect(resolveCodexFrame('success', null)).toMatchObject({ row: 3, loop: false })
  })

  it('resolveCodexFrame 支持数字行号与部分覆盖', () => {
    expect(resolveCodexFrame('idle', { motions: { idle: 4 } })).toMatchObject({ row: 4, frames: 6, interval: 160 })
    // 自定义 spec 未给 durations 时继承内置表的逐帧时长
    expect(resolveCodexFrame('idle', { motions: { idle: { row: 5, frames: 12, interval: 90, loop: false } } }))
      .toEqual({ row: 5, frames: 12, interval: 90, durations: [280, 110, 110, 140, 140, 320], loop: false })
    // 只覆盖一项时其余取内置值
    expect(resolveCodexFrame('idle', { motions: { idle: { row: 2, frames: 9 } } }))
      .toEqual({ row: 2, frames: 9, interval: 160, durations: [280, 110, 110, 140, 140, 320], loop: true })
  })

  it('resolveCodexFrame 支持自定义逐帧时长覆盖', () => {
    expect(resolveCodexFrame('idle', { motions: { idle: { row: 0, durations: [500, 100] } } }).durations)
      .toEqual([500, 100])
    // 非 idle 行也能通过 durations 获得逐帧时长
    expect(resolveCodexFrame('success', { motions: { success: { row: 3, durations: [140, 140, 280] } } }).durations)
      .toEqual([140, 140, 280])
  })

  it('resolveLookIndex：16 格 / 死区 / 非法输入', () => {
    expect(resolveLookIndex({ x: 0, y: -10 })).toBe(0) // 上
    expect(resolveLookIndex({ x: 10, y: 0 })).toBe(4) // 右
    expect(resolveLookIndex({ x: 0, y: 10 })).toBe(8) // 下
    expect(resolveLookIndex({ x: -10, y: 0 })).toBe(12) // 左
    expect(resolveLookIndex({ x: 3, y: 4 }, 10)).toBeUndefined() // 死区内
    expect(resolveLookIndex({ x: 30, y: 40 }, 10)).toBe(resolveLookIndex({ x: 30, y: 40 }))
    expect(resolveLookIndex(0)).toBe(0)
    expect(resolveLookIndex(null)).toBeUndefined()
    expect(resolveLookIndex({ x: Number.NaN, y: 0 })).toBeUndefined()
    expect(resolveLookIndex({ x: 0, y: 0 })).toBeUndefined()
  })
})

describe('配置形状判定', () => {
  it('isDshPetConfig / isCodexPetConfig', () => {
    expect(isDshPetConfig(config)).toBe(true)
    expect(isDshPetConfig({ animations: { idle: ['a'] } })).toBe(true)
    expect(isDshPetConfig({ motions: { idle: '待机' } })).toBe(true)
    expect(isDshPetConfig({ animations: { idle: ['a'] } })).toBe(true)
    expect(isDshPetConfig({ spriteVersionNumber: 2 })).toBe(false)

    expect(isCodexPetConfig({ id: 'nastya', spriteVersionNumber: 2, spritesheetPath: 'spritesheet.webp' })).toBe(true)
    expect(isCodexPetConfig({ motions: { idle: 0 } })).toBe(true)
    expect(isCodexPetConfig({ motions: { idle: { row: 3, frames: 4 } } })).toBe(true)
    expect(isCodexPetConfig({ animations: { idle: ['a'] } })).toBe(false)
  })

  it('detectPetKind：协议字段优先，歧义时看 uri', () => {
    expect(detectPetKind(config)).toBe('dsh')
    expect(detectPetKind({ spriteVersionNumber: 2 })).toBe('codex')
    // 只有 motions 时两种都像 → 按 uri 判
    expect(detectPetKind({ motions: { idle: '待机' } }, { default: '/webm' })).toBe('dsh')
    expect(detectPetKind({ motions: { idle: 0 } }, '/pets/x/spritesheet.webp')).toBe('codex')
    expect(detectPetKind(null, 'https://cdn/pet/spritesheet.webp?v=1')).toBe('codex')
    expect(detectPetKind(null, 'https://cdn/pet/webm')).toBe('dsh')
    expect(detectPetKind(null)).toBe('dsh')
  })

  it('supportsIdleRoll 只在配置声明了权重或分类时为真', () => {
    expect(supportsIdleRoll(config)).toBe(true)
    expect(supportsIdleRoll({ animations: { categories: [{ id: 'x', weight: 1, actions: ['a'] }] } })).toBe(true)
    expect(supportsIdleRoll({ animations: { idle: ['待机'] } })).toBe(false)
    expect(supportsIdleRoll(null)).toBe(false)
  })
})

describe('尺寸与参数归一化', () => {
  it('selectPetEntry：缺省取第一个，未知 id 回落第一个', () => {
    expect(selectPetEntry(config)?.id).toBe('main')
    expect(selectPetEntry(config, 'second')?.id).toBe('second')
    expect(selectPetEntry(config, 'nope')?.id).toBe('main')
    expect(selectPetEntry({ })?.id).toBeUndefined()
  })

  it('resolvePetSize：prop > 配置 size > 宠物条目 size > 渲染器默认基准', () => {
    expect(resolvePetSize({ size: 100, config, petEntry: config.pets![0] })).toBe(100)
    expect(resolvePetSize({ config, petEntry: config.pets![1] })).toBe(300)
    expect(resolvePetSize({ config: { size: 250 } })).toBe(250)
    expect(resolvePetSize({ sizePercent: 100 })).toBe(462)
    expect(resolvePetSize({ sizePercent: 50 })).toBe(231)
    // 百分比夹取
    expect(resolvePetSize({ sizePercent: 1000 })).toBe(924)
    expect(resolvePetSize({ sizePercent: 0 })).toBe(231)
    // 非法数值一律忽略
    expect(resolvePetSize({ size: Number.NaN, sizePercent: 100 })).toBe(462)
  })

  it('codex 的默认基准是 dsh-pet 的一半（同宽度下人物约为两倍大）', () => {
    expect(CODEX_DEFAULT_SIZE).toBe(PET_BASE_WIDTH / 2)
    expect(resolvePetSize({ fallbackSize: CODEX_DEFAULT_SIZE })).toBe(231)
    // 显式 size / 配置 size 仍然优先于默认基准
    expect(resolvePetSize({ size: 200, fallbackSize: CODEX_DEFAULT_SIZE })).toBe(200)
    expect(resolvePetSize({ config: { size: 180 }, fallbackSize: CODEX_DEFAULT_SIZE })).toBe(180)
    // 没有 fallback 时回到基准百分比（dsh-pet 的 462）
    expect(resolvePetSize({})).toBe(462)
    expect(resolvePetSize({ fallbackSize: 0 })).toBe(462)
  })

  it('resolveWeights / resolvePhysics 填默认值', () => {
    expect(resolveWeights(undefined)).toEqual({ idle: 10, turn: 5, move: 5 })
    expect(resolveWeights({ idle: 1 })).toEqual({ idle: 1, turn: 5, move: 5 })
    expect(resolvePhysics(undefined)).toEqual({
      gravity: 1400,
      restitution: 0.78,
      groundFriction: 2.5,
      ceilingBounce: true,
      throwPower: 1,
      petCollision: false,
    })
    expect(resolvePhysics({ gravity: 0, petCollision: true })).toMatchObject({ gravity: 0, petCollision: true })
  })
})

describe('资源地址解析', () => {
  it('目录拼接 + 中文动画名编码', () => {
    expect(resolveAssetUrl('https://cdn/webm', '待机呼吸休闲', 'webm'))
      .toBe(`https://cdn/webm/${encodeURIComponent('待机呼吸休闲')}.webm`)
    expect(resolveAssetUrl('https://cdn/webm/', 'idle', '.webm')).toBe('https://cdn/webm/idle.webm')
  })

  it('模板占位符', () => {
    expect(resolveAssetUrl('https://cdn/{name}.{ext}', '待机', 'webm'))
      .toBe(`https://cdn/${encodeURIComponent('待机')}.webm`)
    expect(resolveAssetUrl('/a/{ext}/{name}', 'x', '.mov')).toBe('/a/mov/x')
  })

  it('完整文件地址原样使用', () => {
    expect(resolveAssetUrl('https://cdn/idle.webm', 'ignored', 'webm')).toBe('https://cdn/idle.webm')
    expect(resolveAssetUrl('https://cdn/pet.json?x=1', 'i', 'webm')).toBe('https://cdn/pet.json?x=1')
  })

  it('空 base 退化为相对文件名；扩展名归一化', () => {
    expect(resolveAssetUrl('', 'idle', 'webm')).toBe('idle.webm')
    expect(normalizeExtension('.mov', 'webm')).toBe('mov')
    expect(normalizeExtension('', 'webm')).toBe('webm')
    expect(normalizeExtension(undefined, 'webm')).toBe('webm')
  })

  it('按平台取 ext / uri', () => {
    expect(resolvePlatformValue({ default: 'webm', mac: 'mov' }, true)).toBe('mov')
    expect(resolvePlatformValue({ default: 'webm', mac: 'mov' }, false)).toBe('webm')
    expect(resolvePlatformValue({ default: 'webm' }, true)).toBe('webm')
  })
})

describe('媒体 MIME 推断', () => {
  it('修正 raw.githubusercontent 把 webm 标成 audio/webm 的问题', () => {
    expect(inferMediaType('https://x/a.webm', 'audio/webm')).toBe('video/webm')
    expect(inferMediaType('https://x/待机.webm', 'application/octet-stream')).toBe('video/webm')
    expect(inferMediaType('https://x/a.mov', null)).toBe('video/quicktime')
    expect(inferMediaType('https://x/a.webp')).toBe('image/webp')
    expect(inferMediaType('https://x/a.mp4')).toBe('video/mp4')
  })

  it('已经正确的类型原样保留', () => {
    expect(inferMediaType('https://x/a.webm', 'video/webm')).toBe('video/webm')
    expect(inferMediaType('https://x/a.webp', 'image/webp')).toBe('image/webp')
  })

  it('带查询串也能识别；未知类型回落', () => {
    expect(inferMediaType('https://x/a.webm?v=2')).toBe('video/webm')
    expect(inferMediaType('https://x/a.bin')).toBe('application/octet-stream')
    expect(inferMediaType('https://x/a.bin', 'application/json')).toBe('application/json')
  })
})

describe('双缓冲切换判重（useVideoCrossfade）', () => {
  it('首次一定加载', () => {
    expect(shouldReloadAnimation(null, { src: 'a.webm', once: false, seq: 0 })).toBe(true)
  })

  it('同一目标（含同一档位反复下发）不重载 —— 动画不会一直从头播', () => {
    const target = { src: 'a.webm', once: false, seq: 0 }
    expect(shouldReloadAnimation(target, { ...target })).toBe(false)
  })

  it('资源变化 / 循环语义变化 / 显式重播（seq）都要重载', () => {
    const target = { src: 'a.webm', once: false, seq: 0 }
    expect(shouldReloadAnimation(target, { ...target, src: 'b.webm' })).toBe(true)
    expect(shouldReloadAnimation(target, { ...target, once: true })).toBe(true)
    expect(shouldReloadAnimation(target, { ...target, seq: 1 })).toBe(true)
  })
})
