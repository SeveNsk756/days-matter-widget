'use strict'

;(function () {
try {

/**
 * 中国法定节假日日期计算
 *
 * 公历固定节日（元旦、劳动节、国庆节）直接取月日；
 * 农历节日（春节、端午、中秋）通过 lunar-javascript 换算；
 * 清明是节气，逐年按太阳黄经推定（4 月 4–6 日之间）。
 *
 * 注意：这里只算「节日当天」，不含每年国务院公告的调休放假安排。
 */

// lunar.js 在浏览器里把 Solar / Lunar 逐个挂到 window 上（是带 fromYmd 方法的对象，不是构造函数）
const hasWindowLib = (typeof window !== 'undefined') &&
  !!window.Solar && typeof window.Solar.fromYmd === 'function' &&
  !!window.Lunar && typeof window.Lunar.fromYmd === 'function'
const Solar = hasWindowLib ? window.Solar : require('./lib/lunar.js').Solar
const Lunar = hasWindowLib ? window.Lunar : require('./lib/lunar.js').Lunar

const HOLIDAY_DEFS = [
  { id: 'h-newyear', title: '元旦', color: '#5aa9ff', fixed: [1, 1] },
  { id: 'h-spring', title: '春节', color: '#ff5c5c', lunar: [1, 1], hint: '农历正月初一' },
  { id: 'h-qingming', title: '清明节', color: '#5ac8a8', solarTerm: '清明' },
  { id: 'h-labour', title: '劳动节', color: '#ff9f43', fixed: [5, 1] },
  { id: 'h-dragon', title: '端午节', color: '#4ade80', lunar: [5, 5], hint: '农历五月初五' },
  { id: 'h-midautumn', title: '中秋节', color: '#fbbf24', lunar: [8, 15], hint: '农历八月十五' },
  { id: 'h-national', title: '国庆节', color: '#ff6b6b', fixed: [10, 1] }
]

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad (n) { return String(n).padStart(2, '0') }

function ymd (d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fromYmd (s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

// 官方对照表里的键 → 节日 id
const TABLE_KEY = {
  'h-spring': 'spring',
  'h-qingming': 'qingming',
  'h-dragon': 'dragon',
  'h-midautumn': 'midautumn'
}

function dateOfYear (def, year, table) {
  // 1. 先看香港天文台《公历与农历对照表》，有就用官方的
  if (table) {
    const key = TABLE_KEY[def.id]
    const rec = key ? (table[year] || table[String(year)]) : null
    if (rec && rec[key]) {
      const d = fromYmd(rec[key])
      if (d) return d
    }
  }

  // 2. 固定公历节日
  if (def.fixed) {
    return new Date(year, def.fixed[0] - 1, def.fixed[1])
  }
  // 3. 兜底：内置历法库
  if (def.lunar) {
    const solar = Lunar.fromYmd(year, def.lunar[0], def.lunar[1]).getSolar()
    return new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay())
  }
  if (def.solarTerm) {
    // 清明总在 4 月：逐日判定节气
    for (let day = 1; day <= 30; day++) {
      const s = Solar.fromYmd(year, 4, day)
      if (s.getLunar().getJieQi() === def.solarTerm) {
        return new Date(year, 3, day)
      }
    }
  }
  return null
}

/**
 * 取每个节日的「下一次」日期并升序返回。
 * @param {Date} [today] 基准日期，默认今天
 * @param {Object} [table] 天文台对照表 { "2027": { spring, qingming, dragon, midautumn } }
 */
function getHolidays (today, table) {
  const base = today ? new Date(today) : new Date()
  if (Number.isNaN(base.getTime())) return []
  const t0 = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const year = t0.getFullYear()
  const out = []

  for (const def of HOLIDAY_DEFS) {
    let d = dateOfYear(def, year, table)
    if (!d || d.getTime() < t0.getTime()) d = dateOfYear(def, year + 1, table)
    if (!d) continue
    out.push({
      id: def.id,
      title: def.title,
      color: def.color,
      date: ymd(d),
      hint: def.hint || '',
      week: WEEK[d.getDay()],
      kind: 'holiday'
    })
  }

  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return out
}

/** 今天是不是某个法定节日，是则返回该节日定义 */
function holidayToday (today, table) {
  const list = getHolidays(today, table)
  const t = today ? new Date(today) : new Date()
  const key = ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate()))
  const hit = list.find(h => h.date === key)
  return hit || null
}

/**
 * 用官方公告的放假安排，核对本地算出来的节日日期。
 * 节日当天必定落在该节日的连休区间内，对不上就说明有一方出了问题。
 * @param {Array} holidays getHolidays 的返回值
 * @param {Object} netData  { "2026": { days: [{date, holiday, name}] } }
 */
function verifyAgainstNet (holidays, netData) {
  const res = { checked: 0, mismatches: [] }
  if (!netData || !Array.isArray(holidays) || !holidays.length) return res

  holidays.forEach((h) => {
    const year = Number(String(h.date).slice(0, 4))
    const rec = netData[year] || netData[String(year)]
    if (!rec || !Array.isArray(rec.days)) return

    const key = String(h.title || '').replace(/节$/, '')
    if (!key) return
    const group = rec.days.filter((d) => d && d.holiday && String(d.name || '').includes(key))
    if (!group.length) return

    res.checked += 1
    const dates = group.map((d) => String(d.date)).sort()
    if (dates.indexOf(h.date) === -1) {
      res.mismatches.push({ title: h.title, computed: h.date, range: [dates[0], dates[dates.length - 1]] })
    }
  })

  return res
}

const api = { HOLIDAY_DEFS, getHolidays, holidayToday, verifyAgainstNet }

if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof window !== 'undefined') window.HolidayKit = api

} catch (err) {
  // 出问题时不要让页面白屏，把原因暴露出来方便排查
  if (typeof window !== 'undefined') window.__HOLIDAY_ERROR = String((err && err.message) || err)
  if (typeof console !== 'undefined') console.error('[holiday] 初始化失败', err)
}
})()
