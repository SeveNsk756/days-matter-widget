'use strict'

const $ = (sel) => document.querySelector(sel)
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const FALLBACK_ACCENT = '#5aa9ff'

let cfg = null
let dragging = false
let movedDistance = 0
let downPoint = null
let wheelLock = false
let toastTimer = null

const card = $('#card')
const dotsEl = $('#dots')
const labelEl = $('#label')
const numEl = $('#num')
const unitEl = $('#unit')
const metaEl = $('#meta')
const toastEl = $('#toast')

/* ---------------- 日期工具 ---------------- */

function parseDate (str) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(str || '').trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(d.getTime())) return null
  return d
}

function todayZero () {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

function daysBetween (a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function fmtDate (d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const LUNAR_MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月']

const LUNAR_DAYS = (() => {
  const ones = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  const out = []
  for (let i = 1; i <= 30; i++) {
    if (i <= 10) out.push('初' + ones[i - 1])
    else if (i < 20) out.push('十' + ones[i - 11])
    else if (i === 20) out.push('二十')
    else if (i < 30) out.push('廿' + ones[i - 21])
    else out.push('三十')
  }
  return out
})()

function lunarLabel (month, day) {
  const m = LUNAR_MONTHS[Number(month) - 1] || Number(month) + '月'
  const d = LUNAR_DAYS[Number(day) - 1] || Number(day) + '日'
  return m + d
}

/**
 * 农历月日 → 离今天最近（含今天）的那个公历日期。
 * 农历年跨公历年，前后各多扫两年；遇到小月没有三十这类情况直接跳过该年。
 */
function lunarToSolarNear (month, day, today) {
  const L = window.Lunar
  if (!L || typeof L.fromYmd !== 'function') return null
  for (let y = today.getFullYear() - 1; y <= today.getFullYear() + 2; y++) {
    try {
      const s = L.fromYmd(y, month, day).getSolar()
      const d = new Date(s.getYear(), s.getMonth() - 1, s.getDay())
      if (!isNaN(d.getTime()) && d.getTime() >= today.getTime()) return d
    } catch (e) { /* 这一年这个月没有三十，跳过 */ }
  }
  return null
}

/**
 * 把「事件里写的日期」换算成「这一次要数的日期」。
 * 不重复 = 就那一天；每年 / 每月 / 每周 = 最近一次还没过去的那个。
 */
function resolveTarget (ev, today) {
  // 农历事件：按农历月日找下一次
  if (ev.calendar === 'lunar' && ev.lunarMonth && ev.lunarDay) {
    return lunarToSolarNear(Number(ev.lunarMonth), Number(ev.lunarDay), today)
  }
  const base = parseDate(ev.date)
  if (!base) return null
  const repeat = ev.repeat || 'once'
  if (repeat === 'yearly') {
    let d = new Date(today.getFullYear(), base.getMonth(), base.getDate())
    if (d.getTime() < today.getTime()) {
      d = new Date(today.getFullYear() + 1, base.getMonth(), base.getDate())
    }
    return d
  }
  if (repeat === 'monthly') {
    let d = new Date(today.getFullYear(), today.getMonth(), base.getDate())
    if (d.getTime() < today.getTime()) {
      d = new Date(today.getFullYear(), today.getMonth() + 1, base.getDate())
    }
    return d
  }
  if (repeat === 'weekly') {
    const d = new Date(today)
    d.setDate(today.getDate() + ((base.getDay() - today.getDay() + 7) % 7))
    return d
  }
  return base
}

/* ---------------- 列表（自定义 + 法定节假日） ---------------- */

const HolidayKit = window.HolidayKit

let holidayCache = { key: '', list: [] }

function holidayItems () {
  if (!cfg || cfg.showHolidays === false) return []
  const key = fmtDate(todayZero())
  if (holidayCache.key !== key) {
    let list = []
    // 节假日算不出来时不能让整张卡片挂掉，退化成只显示自定义纪念日
    try {
      list = HolidayKit.getHolidays(todayZero(), cfg && cfg.lunarHolidays)
    } catch (err) {
      list = []
    }
    holidayCache = { key, list }
  }
  return holidayCache.list.map(withHolidayHint)
}

/** 用联网抓到的放假安排，给节日补一句「放假 N 天」 */
function withHolidayHint (h) {
  const data = cfg && cfg.holidayData
  if (!data) return h
  const year = Number(String(h.date || '').slice(0, 4))
  const bucket = data[year]
  if (!bucket || !Array.isArray(bucket.days)) return h

  const norm = (s) => String(s || '').replace(/[节假日]/g, '')
  const key = norm(h.title)
  const hits = bucket.days.filter((d) => d.holiday && norm(d.name).indexOf(key) >= 0)
  if (!hits.length) return h

  // 找最长的一段连续放假日
  let best = null
  let cur = null
  hits.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((d) => {
    const t = new Date(d.date + 'T00:00:00').getTime()
    if (cur && t - cur.last === 86400000) {
      cur.end = d.date
      cur.last = t
      cur.count++
    } else {
      cur = { start: d.date, end: d.date, last: t, count: 1 }
    }
    if (!best || cur.count > best.count) best = cur
  })
  if (!best) return h
  return Object.assign({}, h, {
    hint: best.count > 1 ? `放假 ${best.count} 天` : '当天放假'
  })
}

/** 排序键：今天 0、明天 1…… 未来越远越大；已过去的日子排在所有未来之后 */
function distanceKey (item, today) {
  const t = resolveTarget(item, today)
  if (!t) return Number.MAX_SAFE_INTEGER
  const days = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - today) / 86400000)
  return days >= 0 ? days : 100000 + Math.abs(days)
}

function allItems () {
  // 自定义事件自带 kind（day / birthday），不要覆盖；节假日用的是 kind: holiday
  const custom = (cfg && cfg.events ? cfg.events : []).map((e) => Object.assign({}, e))
  const list = custom.concat(holidayItems())
  // 统一按「距离今天由近到远」排，跟主进程切换顺序保持一致
  const today = todayZero()
  return list
    .map((it, i) => ({ it, i, k: distanceKey(it, today) }))
    .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k - b.k))
    .map((x) => x.it)
}

function currentEvent () {
  const items = allItems()
  if (!items.length) return null
  return items.find((e) => e.id === cfg.currentId) || items[0]
}

/* ---------------- 渲染 ---------------- */

function render (animate) {
  const ev = currentEvent()
  document.body.dataset.theme = cfg.theme === 'light' ? 'light' : 'dark'
  if (!ev) return

  card.style.setProperty('--accent', ev.color || FALLBACK_ACCENT)

  const today = todayZero()
  const target = resolveTarget(ev, today)
  if (!target) {
    labelEl.textContent = '「' + ev.title + '」的日期格式不对'
    numEl.textContent = '-'
    unitEl.textContent = ''
    metaEl.textContent = ev.calendar === 'lunar' ? '农历日期没算出来，请在设置里检查' : '请在设置里改成 YYYY-MM-DD'
    return
  }
  const base = parseDate(ev.date)
  const isBirthday = ev.kind === 'birthday'

  const diff = daysBetween(today, target)
  const extra = cfg.includeToday ? 1 : 0
  const count = Math.abs(diff) + extra

  let label = ''
  let numText = String(count)
  let unit = '天'
  let numClass = ''

  if (diff > 0) {
    label = isBirthday ? `距离「${ev.title}」生日还有` : `距离「${ev.title}」还有`
  } else if (diff === 0) {
    label = isBirthday ? `「${ev.title}」生日快乐` : `「${ev.title}」`
    numText = '今天'
    unit = ''
    numClass = 'word'
  } else {
    label = `「${ev.title}」已经过去`
  }

  if (numText.length === 3) numClass = 'wide'
  else if (numText.length === 4) numClass = 'wider'
  else if (numText.length >= 5) numClass = 'wider'

  numEl.className = 'num' + (numClass ? ' ' + numClass : '')
  numEl.textContent = numText
  labelEl.textContent = label
  unitEl.textContent = unit
  unitEl.style.display = unit ? '' : 'none'

  metaEl.style.display = cfg.showMeta === false ? 'none' : ''
  const wd = WEEK[target.getDay()]
  const parts = []
  if (ev.kind === 'holiday' && ev.hint) parts.push(ev.hint)
  if (ev.calendar === 'lunar' && ev.lunarMonth && ev.lunarDay) {
    parts.push('农历' + lunarLabel(ev.lunarMonth, ev.lunarDay))
  }
  if (isBirthday && base && (ev.repeat || 'once') === 'yearly') {
    const age = target.getFullYear() - base.getFullYear()
    if (age > 0) parts.push(`满 ${age} 岁`)
  }
  metaEl.textContent = `${fmtDate(target)} · ${wd}${parts.length ? ' · ' + parts.join(' · ') : ''}`

  renderDots()

  if (animate) {
    document.body.classList.add('switching')
    setTimeout(() => document.body.classList.remove('switching'), 150)
  }
}

function renderDots () {
  dotsEl.innerHTML = ''
  const list = allItems()
  const idx = list.findIndex((e) => e.id === cfg.currentId)

  if (list.length <= 6) {
    list.forEach((e, i) => {
      const d = document.createElement('div')
      d.className = 'dot' + (i === idx ? ' active' : '')
      dotsEl.appendChild(d)
    })
  } else {
    const c = document.createElement('div')
    c.className = 'counter'
    c.textContent = `${idx + 1} / ${list.length}`
    dotsEl.appendChild(c)
  }
}

function flash (text) {
  toastEl.textContent = text
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400)
}

/* ---------------- 切换纪念日 ---------------- */

async function step (dir) {
  cfg = await window.api.nextEvent(dir)
  render(true)
}

/* ---------------- 事件绑定 ---------------- */

$('#prev').addEventListener('click', (e) => { e.stopPropagation(); step(-1) })
$('#next').addEventListener('click', (e) => { e.stopPropagation(); step(1) })
$('#gear').addEventListener('click', (e) => { e.stopPropagation(); window.api.openSettings() })

card.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.api.openMenu()
})

// 拖动：交给主进程跟随光标移动窗口
card.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  if (e.target.closest('button')) return
  e.preventDefault()
  downPoint = { x: e.screenX, y: e.screenY }
  movedDistance = 0
  dragging = true
  document.body.classList.add('dragging')
  window.api.dragStart()
})

window.addEventListener('mousemove', (e) => {
  if (!dragging || !downPoint) return
  movedDistance = Math.max(movedDistance, Math.abs(e.screenX - downPoint.x) + Math.abs(e.screenY - downPoint.y))
})

function endDrag () {
  if (!dragging) return
  dragging = false
  document.body.classList.remove('dragging')
  window.api.dragEnd()
}
window.addEventListener('mouseup', endDrag)
window.addEventListener('blur', endDrag)

// 双击：把今天算进去 / 不算进去
card.addEventListener('dblclick', (e) => {
  if (e.target.closest('button')) return
  if (movedDistance > 4) return
  cfg.includeToday = !cfg.includeToday
  window.api.saveConfig({ includeToday: cfg.includeToday })
  render()
  flash(cfg.includeToday ? '已把今天算进天数' : '今天不计入天数')
})

// 滚轮切换（需要按住 Ctrl，避免光标扫过卡片时误切）
card.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return
  e.preventDefault()
  if (wheelLock) return
  wheelLock = true
  setTimeout(() => { wheelLock = false }, 280)
  step(e.deltaY > 0 ? 1 : -1)
}, { passive: false })

/* ---------------- 启动 ---------------- */

window.api.onConfigChanged((next) => {
  const prevId = cfg ? cfg.currentId : null
  cfg = next
  render(prevId !== cfg.currentId)
})

window.api.getConfig().then((c) => {
  cfg = c
  render()
  // 跨天自动刷新
  setInterval(() => {
    if (!cfg) return
    render()
  }, 60 * 1000)
})
