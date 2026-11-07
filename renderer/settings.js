'use strict'

const $ = (s) => document.querySelector(s)
const COLORS = ['#5aa9ff', '#ff8f6b', '#ff7ba9', '#a78bfa', '#4ade80', '#fbbf24', '#22d3ee', '#f472b6']
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

let cfg = null
let editing = null          // { id | 'new', title, date, color }
let formDirty = false

/* ---------------- 日期 ---------------- */

function parseDate (str) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(str || '').trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

function fmtDate (d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function diffDays (str) {
  const t = parseDate(str)
  if (!t) return null
  const n = new Date()
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate())
  return Math.round((t.getTime() - today.getTime()) / 86400000)
}

function relativeText (str) {
  const d = diffDays(str)
  if (d === null) return '日期无效'
  if (d === 0) return '就是今天'
  if (d > 0) return `还有 ${d} 天`
  return `已过 ${-d} 天`
}

/* ---------------- 重复规则 ---------------- */

const REPEAT_LABEL = { once: '', yearly: '每年', monthly: '每月', weekly: '每周' }

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

function resolveTarget (ev, today) {
  if (ev.calendar === 'lunar' && ev.lunarMonth && ev.lunarDay) {
    return lunarToSolarNear(Number(ev.lunarMonth), Number(ev.lunarDay), today)
  }
  const base = parseDate(ev.date)
  if (!base) return null
  const repeat = ev.repeat || 'once'
  if (repeat === 'yearly') {
    let d = new Date(today.getFullYear(), base.getMonth(), base.getDate())
    if (d.getTime() < today.getTime()) d = new Date(today.getFullYear() + 1, base.getMonth(), base.getDate())
    return d
  }
  if (repeat === 'monthly') {
    let d = new Date(today.getFullYear(), today.getMonth(), base.getDate())
    if (d.getTime() < today.getTime()) d = new Date(today.getFullYear(), today.getMonth() + 1, base.getDate())
    return d
  }
  if (repeat === 'weekly') {
    const d = new Date(today)
    d.setDate(today.getDate() + ((base.getDay() - today.getDay() + 7) % 7))
    return d
  }
  return base
}

function todayZero () {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

function relativeTextOfDate (t) {
  const d = Math.round((t.getTime() - todayZero().getTime()) / 86400000)
  if (d === 0) return '就是今天'
  if (d > 0) return `${d} 天后`
  return `${-d} 天前`
}

/* ---------------- 列表 ---------------- */

function renderList () {
  const list = $('#list')
  list.innerHTML = ''

  if (!cfg.events.length) {
    const empty = document.createElement('div')
    empty.className = 'item'
    empty.innerHTML = '<div class="item-main"><div class="item-title" style="color:#8a93a8">还没有纪念日，先添加一个吧</div></div>'
    list.appendChild(empty)
  }

  cfg.events.forEach((ev) => {
    const row = document.createElement('div')
    row.className = 'item' + (ev.id === cfg.currentId ? ' active' : '')
    row.style.setProperty('--c', ev.color || '#5aa9ff')

    const swatch = document.createElement('span')
    swatch.className = 'swatch'
    swatch.style.background = ev.color || '#5aa9ff'
    row.appendChild(swatch)

    const main = document.createElement('div')
    main.className = 'item-main'

    const head = document.createElement('div')
    head.className = 'item-head'

    const title = document.createElement('div')
    title.className = 'item-title'
    title.textContent = ev.title
    head.appendChild(title)

    if (REPEAT_LABEL[ev.repeat || 'once'] && ev.kind !== 'birthday') {
      const t = document.createElement('span')
      t.className = 'tag'
      t.textContent = REPEAT_LABEL[ev.repeat]
      head.appendChild(t)
    }
    if (ev.kind === 'birthday') {
      const t = document.createElement('span')
      t.className = 'tag bd'
      t.textContent = '生日'
      head.appendChild(t)
    }
    if (ev.id === cfg.currentId) {
      const t = document.createElement('span')
      t.className = 'tag on'
      t.textContent = '显示中'
      head.appendChild(t)
    }

    const meta = document.createElement('div')
    meta.className = 'item-meta'
    const target = resolveTarget(ev, todayZero())
    const dateText = ev.calendar === 'lunar' && ev.lunarMonth
      ? '农历' + lunarLabel(ev.lunarMonth, ev.lunarDay)
      : ev.date
    meta.textContent = target
      ? `${dateText} · ${relativeTextOfDate(target)}`
      : '日期无效'

    main.appendChild(head)
    main.appendChild(meta)
    row.appendChild(main)

    const ops = document.createElement('div')
    ops.className = 'item-ops'

    if (ev.id !== cfg.currentId) {
      ops.appendChild(makeMini('显示', () => {
        window.api.setCurrent(ev.id)
      }))
    }
    ops.appendChild(makeMini('编辑', () => {
      editing = {
        id: ev.id,
        title: ev.title,
        date: ev.date,
        color: ev.color || COLORS[0],
        repeat: ev.repeat || 'once',
        kind: ev.kind || 'day',
        calendar: ev.calendar || 'solar',
        lunarMonth: ev.lunarMonth || 8,
        lunarDay: ev.lunarDay || 15
      }
      formDirty = false
      renderList()
      renderForm()
    }))
    ops.appendChild(makeMini('删除', () => {
      cfg.events = cfg.events.filter((e) => e.id !== ev.id)
      if (editing && editing.id === ev.id) { editing = null; renderForm() }
      persist({ events: cfg.events })
    }, true))

    row.appendChild(ops)
    list.appendChild(row)
  })

  // 编辑表单放在列表底部
  if (editing) {
    list.appendChild(buildForm())
  }
}

function makeMini (text, onClick, danger) {
  const b = document.createElement('button')
  b.className = 'mini' + (danger ? ' danger' : '')
  b.textContent = text
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
  return b
}

/* ---------------- 表单 ---------------- */

function buildForm () {
  const form = document.createElement('div')
  form.className = 'form'
  form.id = 'formEl'

  // 标题
  const f1 = document.createElement('div')
  f1.className = 'field'
  f1.innerHTML = '<div class="field-label">名称</div>'
  const titleInput = document.createElement('input')
  titleInput.type = 'text'
  titleInput.id = 'fTitle'
  titleInput.placeholder = '例如：高考 / 生日 / 在一起第几天'
  titleInput.value = editing.title || ''
  titleInput.maxLength = 24
  titleInput.addEventListener('input', () => { editing.title = titleInput.value; formDirty = true })
  f1.appendChild(titleInput)
  form.appendChild(f1)

  // 日期（公历 / 农历）
  const f2 = document.createElement('div')
  f2.className = 'field'
  f2.innerHTML = '<div class="field-label">日期</div>'

  const calSeg = document.createElement('div')
  calSeg.className = 'segmented'
  ;[['solar', '公历'], ['lunar', '农历']].forEach(([val, txt]) => {
    const b = document.createElement('button')
    b.className = 'seg' + ((editing.calendar || 'solar') === val ? ' on' : '')
    b.dataset.val = val
    b.textContent = txt
    b.addEventListener('click', () => {
      editing.calendar = val
      formDirty = true
      calSeg.querySelectorAll('.seg').forEach((x) => x.classList.remove('on'))
      b.classList.add('on')
      applyCalendar()
    })
    calSeg.appendChild(b)
  })
  f2.appendChild(calSeg)

  const dateInput = document.createElement('input')
  dateInput.type = 'date'
  dateInput.id = 'fDate'
  dateInput.value = editing.date || ''
  dateInput.addEventListener('input', () => { editing.date = dateInput.value; formDirty = true })
  dateInput.addEventListener('change', () => { editing.date = dateInput.value; formDirty = true })
  f2.appendChild(dateInput)

  const lunarRow = document.createElement('div')
  lunarRow.className = 'lunar-row'

  const monthSel = document.createElement('select')
  monthSel.id = 'fLunarMonth'
  LUNAR_MONTHS.forEach((name, i) => {
    const o = document.createElement('option')
    o.value = String(i + 1)
    o.textContent = name
    if ((editing.lunarMonth || 8) === i + 1) o.selected = true
    monthSel.appendChild(o)
  })

  const daySel = document.createElement('select')
  daySel.id = 'fLunarDay'
  LUNAR_DAYS.forEach((name, i) => {
    const o = document.createElement('option')
    o.value = String(i + 1)
    o.textContent = name
    if ((editing.lunarDay || 15) === i + 1) o.selected = true
    daySel.appendChild(o)
  })

  monthSel.addEventListener('change', () => { editing.lunarMonth = Number(monthSel.value); formDirty = true })
  daySel.addEventListener('change', () => { editing.lunarDay = Number(daySel.value); formDirty = true })

  lunarRow.appendChild(monthSel)
  lunarRow.appendChild(daySel)
  f2.appendChild(lunarRow)

  function applyCalendar () {
    const isLunar = editing.calendar === 'lunar'
    dateInput.style.display = isLunar ? 'none' : ''
    lunarRow.style.display = isLunar ? 'flex' : 'none'
  }
  applyCalendar()

  form.appendChild(f2)

  // 重复
  const fRep = document.createElement('div')
  fRep.className = 'field'
  fRep.innerHTML = '<div class="field-label">重复</div>'
  const seg = document.createElement('div')
  seg.className = 'segmented'
  ;[['once', '不重复'], ['yearly', '每年'], ['monthly', '每月'], ['weekly', '每周']].forEach(([val, txt]) => {
    const b = document.createElement('button')
    b.className = 'seg' + ((editing.repeat || 'once') === val ? ' on' : '')
    b.dataset.val = val
    b.textContent = txt
    b.addEventListener('click', () => {
      editing.repeat = val
      formDirty = true
      seg.querySelectorAll('.seg').forEach((x) => x.classList.remove('on'))
      b.classList.add('on')
    })
    seg.appendChild(b)
  })
  fRep.appendChild(seg)
  form.appendChild(fRep)

  // 颜色
  const f3 = document.createElement('div')
  f3.className = 'field'
  f3.innerHTML = '<div class="field-label">颜色</div>'
  const colors = document.createElement('div')
  colors.className = 'colors'
  COLORS.forEach((c) => {
    const dot = document.createElement('div')
    dot.className = 'color-dot' + (editing.color === c ? ' on' : '')
    dot.style.background = c
    dot.addEventListener('click', () => {
      editing.color = c
      formDirty = true
      colors.querySelectorAll('.color-dot').forEach((el) => el.classList.remove('on'))
      dot.classList.add('on')
    })
    colors.appendChild(dot)
  })
  f3.appendChild(colors)
  form.appendChild(f3)

  // 生日
  const fBd = document.createElement('label')
  fBd.className = 'form-check'
  const bdInput = document.createElement('input')
  bdInput.type = 'checkbox'
  bdInput.id = 'fBirthday'
  bdInput.checked = editing.kind === 'birthday'
  const bdText = document.createElement('span')
  bdText.textContent = '这是生日（自动按每年重复，显示满几岁）'
  bdInput.addEventListener('change', () => {
    editing.kind = bdInput.checked ? 'birthday' : 'day'
    formDirty = true
    if (bdInput.checked) {
      editing.repeat = 'yearly'
      seg.querySelectorAll('.seg').forEach((x) => x.classList.toggle('on', x.dataset.val === 'yearly'))
    }
  })
  fBd.appendChild(bdInput)
  fBd.appendChild(bdText)
  form.appendChild(fBd)

  // 操作
  const actions = document.createElement('div')
  actions.className = 'form-actions'

  const cancel = document.createElement('button')
  cancel.className = 'ghost'
  cancel.textContent = '取消'
  cancel.addEventListener('click', () => {
    editing = null
    formDirty = false
    renderList()
    renderForm()
  })

  const save = document.createElement('button')
  save.className = 'primary'
  save.textContent = editing.id === 'new' ? '添加' : '保存'
  save.addEventListener('click', () => submitForm())

  actions.appendChild(cancel)
  actions.appendChild(save)
  form.appendChild(actions)

  setTimeout(() => titleInput.focus(), 0)
  return form
}

function renderForm () {
  const list = $('#list')
  if (!editing) {
    const old = $('#formEl')
    if (old) old.remove()
    if (cfg) renderList()
    return
  }
  renderList()
  const fresh = $('#fTitle')
  if (fresh) fresh.focus()
}

function submitForm () {
  if (!editing) return
  const title = (editing.title || '').trim()
  const isLunar = editing.calendar === 'lunar'
  let date = editing.date || ''
  let lunarMonth = null
  let lunarDay = null

  if (!title) { flashLine('请先填个名称'); return }

  if (isLunar) {
    lunarMonth = Number(editing.lunarMonth || 8)
    lunarDay = Number(editing.lunarDay || 15)
    const t = lunarToSolarNear(lunarMonth, lunarDay, todayZero())
    if (!t) { flashLine('这个农历日期算不出对应的公历日期'); return }
    date = fmtDate(t)
  } else if (!parseDate(date)) {
    flashLine('请选择一个有效日期')
    return
  }

  const payload = {
    title,
    date,
    color: editing.color || COLORS[0],
    repeat: isLunar ? 'yearly' : (editing.repeat || 'once'),
    kind: editing.kind || 'day',
    calendar: isLunar ? 'lunar' : 'solar',
    lunarMonth,
    lunarDay
  }

  if (editing.id === 'new') {
    const ev = Object.assign({ id: 'e' + Date.now().toString(36) }, payload)
    cfg.events = cfg.events.concat([ev])
    cfg.currentId = ev.id
    editing = null
    persist({ events: cfg.events, currentId: cfg.currentId })
  } else {
    cfg.events = cfg.events.map((e) => e.id === editing.id ? Object.assign({}, e, payload) : e)
    editing = null
    persist({ events: cfg.events })
  }
  formDirty = false
  renderList()
}

function flashLine (text) {
  const sub = $('#subline')
  sub.textContent = text
  sub.style.color = '#ff8b8b'
  setTimeout(() => {
    sub.textContent = '摆件上会显示这些日子'
    sub.style.color = ''
  }, 1600)
}

/* ---------------- 法定节假日 ---------------- */

/** 联网数据里这个节日放几天假（没有数据返回 0） */
function holidayDaysOf (h) {
  const data = cfg && cfg.holidayData
  if (!data) return 0
  const year = Number(String(h.date || '').slice(0, 4))
  const bucket = data[year]
  if (!bucket || !Array.isArray(bucket.days)) return 0
  const norm = (s) => String(s || '').replace(/[节假日]/g, '')
  const key = norm(h.title)
  let max = 0
  let cur = 0
  let last = 0
  bucket.days
    .filter((d) => d.holiday && norm(d.name).indexOf(key) >= 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .forEach((d) => {
      const t = new Date(d.date + 'T00:00:00').getTime()
      if (last && t - last === 86400000) cur++
      else cur = 1
      last = t
      if (cur > max) max = cur
    })
  return max
}

function renderHolidayGrid () {
  const box = $('#holidayGrid')
  if (!box) return
  box.innerHTML = ''
  box.classList.toggle('off', cfg.showHolidays === false)
  const list = window.HolidayKit.getHolidays(new Date(), cfg && cfg.lunarHolidays)
  list.forEach((h) => {
    const item = document.createElement('div')
    item.className = 'h-item'

    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.background = h.color

    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = h.title

    const date = document.createElement('span')
    date.className = 'date'
    const [, m, d] = h.date.split('-')
    const days = holidayDaysOf(h)
    date.textContent = days > 1
      ? `${Number(m)}月${Number(d)}日 · ${days}天`
      : `${Number(m)}月${Number(d)}日`

    item.appendChild(dot)
    item.appendChild(name)
    item.appendChild(date)
    box.appendChild(item)
  })
}

/* ---------------- 持久化 ---------------- */

async function persist (patch) {
  cfg = await window.api.saveConfig(patch)
  renderList()
  syncControls()
}

function syncControls () {
  const theme = cfg.theme === 'light' ? 'light' : 'dark'
  $('#themeSeg').querySelectorAll('.seg').forEach((b) => b.classList.toggle('on', b.dataset.val === theme))

  const scale = Number(cfg.scale) || 1
  $('#scaleSeg').querySelectorAll('.seg').forEach((b) => {
    b.classList.toggle('on', Math.abs(Number(b.dataset.val) - scale) < 0.01)
  })

  $('#swTop').checked = !!cfg.alwaysOnTop
  $('#swLock').checked = !!cfg.locked
  $('#swToday').checked = !!cfg.includeToday
  $('#swMeta').checked = cfg.showMeta !== false
  $('#swAuto').checked = !!cfg.autoStart
  $('#swHoliday').checked = cfg.showHolidays !== false
  renderHolidayGrid()
  renderNetStatus()
}

function renderNetStatus () {
  const el = $('#netStatus')
  if (!el) return
  const data = cfg && cfg.holidayData
  const years = data ? Object.keys(data).filter((k) => /^\d{4}$/.test(k)) : []
  if (!years.length) {
    el.textContent = '还没同步过放假安排，点右侧按钮拉一次'
    return
  }
  const ts = Number(data._updatedAt)
  let when = ''
  if (ts) {
    const d = new Date(ts)
    when = ` · ${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} 更新`
  }
  let note = ''
  try {
    if (window.HolidayKit && window.HolidayKit.verifyAgainstNet) {
      const v = window.HolidayKit.verifyAgainstNet(window.HolidayKit.getHolidays(new Date(), cfg && cfg.lunarHolidays), data)
      if (v.mismatches.length) note = ` · ${v.mismatches.length} 个日期待核实`
      else if (v.checked) note = ' · 已与公告核对'
    }
  } catch (err) { /* 校验出错不影响状态展示 */ }
  el.textContent = `已同步 ${years.join(' / ')} 年 · ${when.replace(' · ', '').trim() || '已缓存'}${note}`
}

/* ---------------- 绑定 ---------------- */

function bind () {
  const closeBtn = $('#closeBtn')
  if (closeBtn) closeBtn.addEventListener('click', () => window.close())

  // 自绘标题栏按钮（全 Windows 版本一致，不依赖系统 titleBarOverlay）
  const titlebar = document.querySelector('.titlebar')
  const wMin = $('#winMin')
  const wMax = $('#winMax')
  const wClose = $('#winClose')
  if (wMin) wMin.addEventListener('click', () => window.api.winMinimize())
  if (wMax) wMax.addEventListener('click', () => window.api.winToggleMaximize())
  if (wClose) wClose.addEventListener('click', () => window.api.winClose())
  if (titlebar) {
    titlebar.addEventListener('dblclick', (e) => {
      if (e.target.closest('.tb-btns')) return
      window.api.winToggleMaximize()
    })
  }
  if (window.api.onWinStateChanged) {
    window.api.onWinStateChanged((isMax) => {
      if (titlebar) titlebar.classList.toggle('is-max', !!isMax)
    })
  }

  $('#addBtn').addEventListener('click', () => {
    editing = {
      id: 'new',
      title: '',
      date: '',
      color: COLORS[cfg.events.length % COLORS.length],
      repeat: 'once',
      kind: 'day',
      calendar: 'solar',
      lunarMonth: 8,
      lunarDay: 15
    }
    formDirty = false
    renderList()
    const d = $('#fDate')
    if (d) d.focus()
  })

  $('#themeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg')
    if (!btn) return
    persist({ theme: btn.dataset.val })
  })

  $('#scaleSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg')
    if (!btn) return
    persist({ scale: Number(btn.dataset.val) })
  })

  $('#swTop').addEventListener('change', (e) => persist({ alwaysOnTop: e.target.checked }))
  $('#swLock').addEventListener('change', (e) => persist({ locked: e.target.checked }))
  $('#swToday').addEventListener('change', (e) => persist({ includeToday: e.target.checked }))
  $('#swMeta').addEventListener('change', (e) => persist({ showMeta: e.target.checked }))
  $('#swAuto').addEventListener('change', (e) => persist({ autoStart: e.target.checked }))
  $('#swHoliday').addEventListener('change', (e) => persist({ showHolidays: e.target.checked }))

  $('#syncBtn').addEventListener('click', async () => {
    const btn = $('#syncBtn')
    const status = $('#netStatus')
    btn.disabled = true
    btn.textContent = '同步中…'
    if (status) status.textContent = '正在联网获取放假安排…'
    try {
      const res = await api.syncHolidays()
      const years = res && res.years ? res.years.filter((y) => /^\d{4}$/.test(y)) : []
      if (status) {
        status.textContent = years.length
          ? `已同步 ${years.join(' / ')} 年的放假安排`
          : '没拿到数据（可能该年份还没公布，或当前没联网）'
      }
    } catch (err) {
      if (status) status.textContent = '同步失败，稍后再试'
    }
    btn.disabled = false
    btn.textContent = '立即同步'
    renderNetStatus()
    renderHolidayGrid()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editing) {
      editing = null
      renderList()
    }
    if (e.key === 'Enter' && editing && e.target.tagName === 'INPUT') {
      submitForm()
    }
  })
}

window.api.onConfigChanged((next) => {
  cfg = next
  syncControls()
  if (!editing) renderList()
})

window.api.getConfig().then((c) => {
  cfg = c
  bind()
  syncControls()
  renderList()
})
