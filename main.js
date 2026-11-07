'use strict'

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const HolidayKit = require('./renderer/holiday.js')
const HolidayNet = require('./renderer/holiday-net.js')
const LunarCal = require('./renderer/lunar-cal.js')
const LunarLib = require('./renderer/lib/lunar.js')

app.setName('DaysMatterWidget')
app.setAppUserModelId('com.daysmatter.widget')

const BASE = { w: 330, h: 186 }
const MIN_SCALE = 0.7
const MAX_SCALE = 2

let win = null
let settingsWin = null
let tray = null
let cfg = null
let configPath = ''
let dragTimer = null
let dragState = null
let saveTimer = null
let quitting = false

/* ------------------------------------------------------------------ *
 *  配置
 * ------------------------------------------------------------------ */

function defaultConfig () {
  return {
    theme: 'dark',
    scale: 1,
    alwaysOnTop: true,
    locked: false,
    autoStart: false,
    includeToday: false,
    showMeta: true,
    showHolidays: true,
    netHoliday: true,
    holidayData: null,
    lunarHolidays: null,
    currentId: 'e1',
    position: null,
    events: defaultEvents()
  }
}

/** 首次启动的示例条目：只放一个通用的「元旦」，日期跟着年份走，不会一装就过期 */
function defaultEvents () {
  const y = new Date().getFullYear() + 1
  return [
    {
      id: 'e1',
      title: '元旦',
      date: y + '-01-01',
      color: '#5aa9ff',
      repeat: 'yearly',
      kind: 'day',
      calendar: 'solar'
    }
  ]
}

function loadConfig () {
  configPath = path.join(app.getPath('userData'), 'config.json')
  HolidayNet.init(app.getPath('userData'))
  LunarCal.init(app.getPath('userData'))
  let loaded = null
  try {
    if (fs.existsSync(configPath)) {
      loaded = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    }
  } catch (err) {
    loaded = null
  }
  cfg = Object.assign(defaultConfig(), loaded || {})
  cfg.holidayData = HolidayNet.loadCache()
  cfg.lunarHolidays = LunarCal.holidaysMap()
  if (!Array.isArray(cfg.events) || cfg.events.length === 0) cfg.events = defaultConfig().events
  cfg.events = cfg.events.filter(e => e && typeof e.title === 'string' && typeof e.date === 'string')
  if (cfg.events.length === 0) cfg.events = defaultConfig().events
  ensureCurrent()
  cfg.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(cfg.scale) || 1))
  saveConfig(true)
}

/* --------- 自定义纪念日 + 法定节假日，统一成一份可切换的列表 --------- */

function holidayItems () {
  if (cfg.showHolidays === false) return []
  return HolidayKit.getHolidays(new Date(), cfg.lunarHolidays)
}

/* 按「距离今天还有几天」排序，滚轮切换就按这个顺序走 */

function startOfDay (d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function parseYmd (s) {
  const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) 
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function lunarNear (month, day, today) {
  const L = LunarLib && LunarLib.Lunar
  if (!L || typeof L.fromYmd !== 'function') return null
  for (let y = today.getFullYear() - 1; y <= today.getFullYear() + 2; y++) {
    try {
      const s = L.fromYmd(y, month, day).getSolar()
      const d = new Date(s.getYear(), s.getMonth() - 1, s.getDay())
      if (!isNaN(d.getTime()) && d.getTime() >= today.getTime()) return d
    } catch (e) { /* 这一年没有这一天，跳过 */ }
  }
  return null
}

/** 这次要数的日期（跟渲染端 resolveTarget 保持一致） */
function targetOf (item, today) {
  if (item.kind === 'holiday') return parseYmd(item.date)
  if (item.calendar === 'lunar' && item.lunarMonth && item.lunarDay) {
    return lunarNear(Number(item.lunarMonth), Number(item.lunarDay), today)
  }
  const base = parseYmd(item.date)
  if (!base) return null
  const repeat = item.repeat || 'once'
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

/**
 * 排序键：今天 0、明天 1…… 未来越远的越大；
 * 已经过去的日子（一次性事件）排在所有未来之后，距今天越近的越靠前。
 */
function distanceKey (item, today) {
  const t = targetOf(item, today)
  if (!t) return Number.MAX_SAFE_INTEGER
  const days = Math.round((startOfDay(t).getTime() - today.getTime()) / 86400000)
  return days >= 0 ? days : 100000 + Math.abs(days)
}

function allItemIds () {
  const today = startOfDay(new Date())
  const items = cfg.events.concat(holidayItems())
  return items
    .map((it, i) => ({ id: it.id, i, k: distanceKey(it, today) }))
    .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k - b.k))
    .map((x) => x.id)
}

function ensureCurrent () {
  const ids = allItemIds()
  if (ids.length && ids.indexOf(cfg.currentId) === -1) cfg.currentId = ids[0]
}

function saveConfig (silent) {
  if (!configPath) return
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8')
  } catch (err) {
    console.error('写入配置失败', err)
  }
  if (!silent) broadcastConfig()
}

function broadcastConfig () {
  const payload = JSON.parse(JSON.stringify(cfg))
  if (win && !win.isDestroyed()) win.webContents.send('cfg:changed', payload)
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('cfg:changed', payload)
}

/* ------------------------------------------------------------------ *
 *  节假日联网同步（国务院放假安排）
 * ------------------------------------------------------------------ */

let syncing = false

async function syncHolidays (force) {
  if (syncing) return HolidayNet.summary()
  syncing = true
  try {
    const year = new Date().getFullYear()
    const years = force ? [year - 1, year, year + 1] : [year, year + 1]
    const res = await HolidayNet.sync(years, force)
    cfg.holidayData = res.years
    try {
      await LunarCal.sync(years, force)
    } catch (err) { /* 官方对照表拿不到就用旧缓存或内置历法 */ }
    cfg.lunarHolidays = LunarCal.holidaysMap()
    saveConfig(true)
    broadcastConfig()
  } catch (err) {
    console.error('同步节假日失败', err)
  } finally {
    syncing = false
  }
  return HolidayNet.summary()
}

function startHolidaySync () {
  if (cfg.netHoliday === false) return
  setTimeout(() => { syncHolidays(false) }, 5000)
  setInterval(() => {
    if (cfg.netHoliday !== false) syncHolidays(false)
  }, 6 * 3600 * 1000)
}

/* ------------------------------------------------------------------ *
 *  窗口
 * ------------------------------------------------------------------ */

function widgetSize () {
  return {
    width: Math.round(BASE.w * cfg.scale),
    height: Math.round(BASE.h * cfg.scale)
  }
}

function isPositionVisible (pos, size) {
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return false
  return screen.getAllDisplays().some(d => {
    const a = d.workArea
    const ow = Math.min(pos.x + size.width, a.x + a.width) - Math.max(pos.x, a.x)
    const oh = Math.min(pos.y + size.height, a.y + a.height) - Math.max(pos.y, a.y)
    return ow > size.width * 0.4 && oh > size.height * 0.4
  })
}

function defaultPosition (size) {
  const area = screen.getPrimaryDisplay().workArea
  return {
    x: area.x + area.width - size.width - 24,
    y: area.y + area.height - size.height - 24
  }
}

function createWidget () {
  const size = widgetSize()
  const pos = isPositionVisible(cfg.position, size) ? cfg.position : defaultPosition(size)

  win = new BrowserWindow({
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    width: size.width,
    height: size.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: cfg.alwaysOnTop,
    show: false,
    title: '纪念日摆件',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  win.setAlwaysOnTop(cfg.alwaysOnTop, 'screen-saver')
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('moved', schedulePosSave)

  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })
}

function schedulePosSave () {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return
    const [x, y] = win.getPosition()
    cfg.position = { x, y }
    saveConfig()
  }, 600)
}

function applyWidgetSettings () {
  if (!win || win.isDestroyed()) return
  const size = widgetSize()
  const b = win.getBounds()
  win.setBounds({ x: b.x, y: b.y, width: size.width, height: size.height })
  win.webContents.setZoomFactor(cfg.scale)
  win.setAlwaysOnTop(cfg.alwaysOnTop, 'screen-saver')
  if (typeof cfg.position === 'object' && cfg.position) {
    // 缩放后保证仍在屏幕内
    if (!isPositionVisible(cfg.position, size)) {
      const p = defaultPosition(size)
      win.setBounds({ x: p.x, y: p.y, width: size.width, height: size.height })
    }
  }
  broadcastConfig()
}

/* ------------------------------------------------------------------ *
 *  设置窗口
 * ------------------------------------------------------------------ */

function openSettings () {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show()
    settingsWin.focus()
    return
  }
  const SW = 460
  const anchor = (win && !win.isDestroyed()) ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()
  const area = anchor.workArea
  const SH = Math.min(800, area.height - 70)
  const x = area.x + Math.round((area.width - SW) / 2)
  const y = area.y + Math.round((area.height - SH) / 2)

  settingsWin = new BrowserWindow({
    width: SW,
    height: SH,
    minWidth: 380,
    minHeight: 420,
    x,
    y,
    show: false,
    title: '纪念日设置',
    backgroundColor: '#0b0d13',
    autoHideMenuBar: true,
    frame: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  settingsWin.setMenu(null)
  settingsWin.setAlwaysOnTop(true, 'screen-saver')
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'))
  settingsWin.once('ready-to-show', () => {
    settingsWin.show()
    settingsWin.focus()
    settingsWin.webContents.send('win:stateChanged', settingsWin.isMaximized())
  })
  settingsWin.on('maximize', () => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('win:stateChanged', true)
  })
  settingsWin.on('unmaximize', () => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('win:stateChanged', false)
  })
  settingsWin.on('closed', () => { settingsWin = null })
}

/* 自绘标题栏的窗口按钮（不依赖系统 titleBarOverlay，Win10 早期版本也能用） */

ipcMain.on('win:minimize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (w) w.minimize()
})

ipcMain.on('win:toggleMaximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w) return
  if (w.isMaximized()) w.unmaximize()
  else w.maximize()
})

ipcMain.on('win:close', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender)
  if (w) w.close()
})

/* ------------------------------------------------------------------ *
 *  托盘
 * ------------------------------------------------------------------ */

function createTray () {
  const iconPath = path.join(__dirname, 'assets', 'icon.png')
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    app.getFileIcon(process.execPath).then(i => {
      if (tray) tray.setImage(i.resize({ width: 16, height: 16 }))
    }).catch(() => {})
    image = nativeImage.createEmpty()
  }
  tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip('纪念日摆件')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示摆件', click: () => { if (win) { win.show(); win.focus() } } },
    { label: '编辑纪念日…', click: openSettings },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } }
  ]))
  tray.on('click', () => {
    if (!win) return
    if (win.isVisible()) win.hide()
    else { win.show(); win.focus() }
  })
}

/* ------------------------------------------------------------------ *
 *  右键菜单
 * ------------------------------------------------------------------ */

function buildEventSubmenu () {
  const items = []
  const mark = (id) => (id === cfg.currentId ? '✓ ' : '　 ')

  cfg.events.forEach((e) => {
    items.push({
      label: `${mark(e.id)}${e.title}`,
      click: () => { cfg.currentId = e.id; saveConfig() }
    })
  })

  const holidays = holidayItems()
  if (holidays.length) {
    if (items.length) items.push({ type: 'separator' })
    holidays.forEach((h) => {
      const [, m, d] = h.date.split('-')
      items.push({
        label: `${mark(h.id)}${h.title}　${Number(m)}月${Number(d)}日`,
        click: () => { cfg.currentId = h.id; saveConfig() }
      })
    })
  }

  return items.length ? items : [{ label: '（还没有纪念日）', enabled: false }]
}

function buildWidgetMenu () {
  return Menu.buildFromTemplate([
    { label: '切换纪念日', submenu: buildEventSubmenu() },
    { label: '　下一个 →', click: () => stepEvent(1) },
    { label: '　← 上一个', click: () => stepEvent(-1) },
    { type: 'separator' },
    { label: '编辑纪念日…', click: openSettings },
    {
      label: cfg.theme === 'dark' ? '切换浅色主题' : '切换深色主题',
      click: () => { cfg.theme = cfg.theme === 'dark' ? 'light' : 'dark'; saveConfig() }
    },
    {
      label: '把今天也算上',
      type: 'checkbox',
      checked: !!cfg.includeToday,
      click: (m) => { cfg.includeToday = m.checked; saveConfig() }
    },
    {
      label: '显示法定节假日',
      type: 'checkbox',
      checked: cfg.showHolidays !== false,
      click: (m) => {
        cfg.showHolidays = m.checked
        ensureCurrent()
        saveConfig()
      }
    },
    { type: 'separator' },
    {
      label: '置顶显示',
      type: 'checkbox',
      checked: !!cfg.alwaysOnTop,
      click: (m) => { cfg.alwaysOnTop = m.checked; applyWidgetSettings() }
    },
    {
      label: '锁定位置',
      type: 'checkbox',
      checked: !!cfg.locked,
      click: (m) => { cfg.locked = m.checked; saveConfig() }
    },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: !!cfg.autoStart,
      click: (m) => { setAutoStart(m.checked) }
    },
    {
      label: '尺寸',
      submenu: [0.8, 1, 1.25, 1.5, 1.75].map(s => ({
        label: `${Math.round(s * 100)}%${cfg.scale === s ? '  ✓' : ''}`,
        click: () => { cfg.scale = s; applyWidgetSettings() }
      }))
    },
    { type: 'separator' },
    { label: '隐藏到托盘', click: () => { if (win) win.hide() } },
    { label: '退出', click: () => { quitting = true; app.quit() } }
  ])
}

ipcMain.on('menu:popup', () => {
  if (!win || win.isDestroyed()) return
  buildWidgetMenu().popup({ window: win })
})

/* ------------------------------------------------------------------ *
 *  开机自启
 * ------------------------------------------------------------------ */

function setAutoStart (enable) {
  cfg.autoStart = !!enable
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enable,
      path: process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()]
    })
  } catch (err) {
    console.error('设置开机自启失败', err)
  }
  saveConfig()
}

/* ------------------------------------------------------------------ *
 *  拖动窗口
 * ------------------------------------------------------------------ */

function stopDrag (save) {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null }
  const wasDragging = !!dragState
  dragState = null
  if (win && !win.isDestroyed()) win.webContents.send('drag:state', false)
  if (save && wasDragging) schedulePosSave()
}

function startDrag () {
  if (!win || win.isDestroyed()) return
  if (cfg.locked) return
  if (dragTimer) return
  const cursor = screen.getCursorScreenPoint()
  const bounds = win.getBounds()
  dragState = { cursor, bounds }
  win.webContents.send('drag:state', true)

  dragTimer = setInterval(() => {
    if (!dragState || !win || win.isDestroyed()) { stopDrag(false); return }
    const p = screen.getCursorScreenPoint()
    const x = dragState.bounds.x + (p.x - dragState.cursor.x)
    const y = dragState.bounds.y + (p.y - dragState.cursor.y)
    const size = widgetSize()
    win.setBounds({ x, y, width: size.width, height: size.height })

    // 光标若离开窗口范围（通常是用户已经在别处松手），自动结束拖动
    const relX = p.x - x
    const relY = p.y - y
    if (relX < -4 || relY < -4 || relX > size.width + 4 || relY > size.height + 4) stopDrag(true)
  }, 16)
}

ipcMain.on('drag:start', startDrag)
ipcMain.on('drag:end', () => stopDrag(true))

/* ------------------------------------------------------------------ *
 *  IPC
 * ------------------------------------------------------------------ */

ipcMain.handle('cfg:get', () => JSON.parse(JSON.stringify(cfg)))

ipcMain.handle('cfg:save', (_evt, patch) => {
  if (patch && typeof patch === 'object') {
    const beforeScale = cfg.scale
    const needApply = 'scale' in patch || 'alwaysOnTop' in patch
    const wasNet = cfg.netHoliday !== false
    Object.assign(cfg, patch)
    if (!Array.isArray(cfg.events) || cfg.events.length === 0) cfg.events = defaultConfig().events
    ensureCurrent()
    cfg.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(cfg.scale) || 1))
    if ('autoStart' in patch) setAutoStart(cfg.autoStart)
    // 刚打开联网开关时立刻补一次同步
    if ('netHoliday' in patch && !wasNet && cfg.netHoliday !== false) {
      syncHolidays(false)
    }
    saveConfig(needApply ? true : false)
    if (needApply) {
      if (cfg.scale !== beforeScale) applyWidgetSettings()
      else { win && win.setAlwaysOnTop(cfg.alwaysOnTop, 'screen-saver'); broadcastConfig() }
    }
  }
  return JSON.parse(JSON.stringify(cfg))
})

ipcMain.handle('event:step', (_evt, step) => {
  stepEvent(Number(step) || 1)
  return JSON.parse(JSON.stringify(cfg))
})

ipcMain.handle('event:current', (_evt, id) => {
  if (allItemIds().indexOf(id) !== -1) { cfg.currentId = id; saveConfig() }
  return JSON.parse(JSON.stringify(cfg))
})

function stepEvent (step) {
  const ids = allItemIds()
  if (!ids.length) return
  let idx = ids.indexOf(cfg.currentId)
  idx = idx < 0 ? 0 : (idx + step + ids.length) % ids.length
  cfg.currentId = ids[idx]
  saveConfig()
}

ipcMain.on('settings:open', openSettings)
ipcMain.on('app:quit', () => { quitting = true; app.quit() })

ipcMain.handle('holiday:sync', () => syncHolidays(true))
ipcMain.handle('holiday:status', () => {
  const net = HolidayNet.summary()
  const cal = LunarCal.summary()
  return Object.assign({}, net, { lunarYears: cal.years })
})

/* ------------------------------------------------------------------ *
 *  生命周期
 * ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) { win.show(); win.focus() }
    if (Array.isArray(argv) && argv.includes('--open-settings')) openSettings()
  })

  app.whenReady().then(() => {
    loadConfig()
    createWidget()
    createTray()
    startHolidaySync()

    // 换分辨率 / 改缩放比例 / 插拔外接屏之后，把摆件拉回可见区域
    const keepWidgetVisible = () => {
      if (!win || win.isDestroyed()) return
      const size = widgetSize()
      const b = win.getBounds()
      if (isPositionVisible({ x: b.x, y: b.y }, size)) return
      const p = defaultPosition(size)
      cfg.position = p
      win.setBounds({ x: Math.round(p.x), y: Math.round(p.y), width: size.width, height: size.height })
      saveConfig()
    }
    screen.on('display-metrics-changed', keepWidgetVisible)
    screen.on('display-added', keepWidgetVisible)
    screen.on('display-removed', keepWidgetVisible)

    // 有些全屏播放器会把自己顶到最前，隔一会儿把窗口重新提回置顶层
    setInterval(() => {
      if (!win || win.isDestroyed() || !cfg.alwaysOnTop) return
      win.setAlwaysOnTop(true, 'screen-saver')
      if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()) {
        settingsWin.setAlwaysOnTop(true, 'screen-saver')
      }
    }, 20000)
    if (process.argv.includes('--open-settings')) setTimeout(openSettings, 800)

    // 首次启动时提示用法
    const flagPath = path.join(app.getPath('userData'), '.welcomed')
    if (!fs.existsSync(flagPath)) {
      try { fs.writeFileSync(flagPath, '1') } catch (_) {}
      setTimeout(() => {
        if (!win || win.isDestroyed()) return
        dialog.showMessageBox(win, {
          type: 'info',
          title: '纪念日摆件已启动',
          message: '摆件就在屏幕右下角。',
          detail: [
            '· 按住卡片任意位置可以拖动它',
            '· 右键卡片可以切换纪念日、换主题、锁定位置',
            '· 按住 Ctrl 滚动滚轮可切换纪念日，双击数字可切换“算不算今天”',
            '· 齿轮按钮或托盘菜单可进入设置，编辑你自己的纪念日',
            '',
            '提示：位置、主题、尺寸都会自动记住。'
          ].join('\n'),
          buttons: ['知道了'],
          noLink: true
        }).catch(() => {})
      }, 700)
    }
  })

  app.on('window-all-closed', () => {
    if (quitting) app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    stopDrag(true)
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    if (cfg) {
      if (win && !win.isDestroyed()) {
        const [x, y] = win.getPosition()
        cfg.position = { x, y }
      }
      saveConfig(true)
    }
  })
}
