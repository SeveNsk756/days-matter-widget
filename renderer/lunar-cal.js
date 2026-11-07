'use strict'

/**
 * 香港天文台《公历与农历对照表》——官方的历法数据。
 *
 * 数据源：https://www.hko.gov.hk/tc/gts/time/calendar/text/files/T<年份>c.txt
 *   每年一份纯文本，一天一行：
 *     2027年2月6日          正月        星期六
 *     2027年4月5日          廿九        星期一      清明
 *   农历每月第一天那一行的「农历日期」列写的是月份名（正月 / 二月 / …），
 *   其余日子写「初二」「廿九」这种日序；节气写在最后一列。
 *
 * 有了这张表，春节 / 端午 / 中秋 / 清明 的日期直接查表就有，
 * 不需要本地推算；拿不到表（断网）时渲染端会退回内置历法库。
 */

const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')

const URL_PREFIX = 'https://www.hko.gov.hk/tc/gts/time/calendar/text/files/T'
const URL_SUFFIX = 'c.txt'
const TIMEOUT = 15000
const CACHE_MS = 30 * 24 * 3600 * 1000

const MONTHS = {
  正月: 1, 一月: 1, 二月: 2, 三月: 3, 四月: 4, 五月: 5, 六月: 6,
  七月: 7, 八月: 8, 九月: 9, 十月: 10, 十一月: 11, 十二月: 12
}

let cachePath = ''

function init (userDataDir) {
  cachePath = path.join(userDataDir, 'lunar-cache.json')
}

function loadCache () {
  if (!cachePath) return {}
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8')) || {}
  } catch (err) {
    return {}
  }
}

function saveCache (data) {
  if (!cachePath) return
  try {
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf8')
  } catch (err) {
    /* 写不进去下次重来 */
  }
}

function pad (n) { return String(n).padStart(2, '0') }

function addDays (ymd, n) {
  const d = new Date(ymd + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function getText (url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'DaysMatterWidget/1.0' }
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error('HTTP ' + res.statusCode))
        return
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => { resolve(body) })
    })
    req.setTimeout(TIMEOUT, () => { req.destroy(new Error('timeout')) })
    req.on('error', reject)
  })
}

/**
 * 把全年对照表解析成
 *   { days: { "2027-02-06": { lunar: "正月", jieqi: "" }, ... },
 *     holidays: { spring: "2027-02-06", qingming: "2027-04-05", dragon: "2027-06-09", midautumn: "2027-09-15" } }
 */
function parseYear (text, year) {
  const days = {}
  const lineRe = /(\d{4})年(\d{1,2})月(\d{1,2})日(.*)/
  const lines = String(text).split(/\r?\n/)

  for (const line of lines) {
    const m = line.match(lineRe)
    if (!m || Number(m[1]) !== year) continue
    const date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`
    const tail = m[4]

    // 星期几之后的部分是节气（可能为空）
    const wk = tail.search(/星期[一二三四五六日天]/)
    let lunarPart = tail
    let jieqi = ''
    if (wk >= 0) {
      lunarPart = tail.slice(0, wk)
      jieqi = tail.slice(wk + 3).trim()
    }
    const lunar = lunarPart.trim()
    if (!lunar) continue
    days[date] = { lunar, jieqi }
  }

  // 从月份首日 + 日序推出四个农历/节气节日的公历日期
  const holidays = {}
  for (const date of Object.keys(days).sort()) {
    const { lunar, jieqi } = days[date]
    const clean = lunar.replace(/^闰/, '')
    const month = MONTHS[clean]
    if (month && !lunar.startsWith('闰')) {
      if (month === 1) holidays.spring = date
      if (month === 5) holidays.dragon = addDays(date, 4)
      if (month === 8) holidays.midautumn = addDays(date, 14)
    }
    if (jieqi === '清明') holidays.qingming = date
  }

  return { days, holidays }
}

/** 取某一年的表；缓存有效期内直接用缓存 */
async function fetchYear (year, force) {
  const cache = loadCache()
  const old = cache[year]
  if (!force && old && old.fetchAt && Date.now() - old.fetchAt < CACHE_MS && old.holidays) {
    return { holidays: old.holidays, cached: true }
  }
  try {
    const text = await getText(URL_PREFIX + year + URL_SUFFIX)
    const parsed = parseYear(text, year)
    const count = Object.keys(parsed.holidays).length
    if (!count) return old ? { holidays: old.holidays, cached: true } : null
    cache[year] = { holidays: parsed.holidays, fetchAt: Date.now() }
    cache._updatedAt = Date.now()
    saveCache(cache)
    return { holidays: parsed.holidays, cached: false }
  } catch (err) {
    return old && old.holidays ? { holidays: old.holidays, cached: true } : null
  }
}

/** 同步若干年份，返回 { years: { "2027": {spring,...} }, changed } */
async function sync (years, force) {
  const changed = []
  for (const year of years) {
    const got = await fetchYear(year, force)
    if (got && !got.cached) changed.push(year)
  }
  return { years: holidaysMap(), changed }
}

/** 只要「节日日期」这张小表，给渲染进程用 */
function holidaysMap () {
  const cache = loadCache()
  const out = {}
  for (const k of Object.keys(cache)) {
    if (!/^\d{4}$/.test(k)) continue
    if (cache[k] && cache[k].holidays) out[k] = cache[k].holidays
  }
  return out
}

function summary () {
  const cache = loadCache()
  const years = Object.keys(cache).filter((k) => /^\d{4}$/.test(k))
  return { years, updatedAt: cache._updatedAt || null, source: '香港天文台' }
}

module.exports = { init, sync, holidaysMap, summary, loadCache, parseYear }
