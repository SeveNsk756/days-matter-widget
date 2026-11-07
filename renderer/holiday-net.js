'use strict'

/**
 * 联网抓取「国务院公布的放假安排」。
 *
 * 数据源（格式一致，依次尝试，一个不行换下一个）：
 *   1. https://holiday.ailcc.com/api/holiday/year/<年份>   跟进最快，公布后很快更新
 *   2. https://timor.tech/api/holiday/year/<年份>          备源
 *   返回：{ code: 0, holiday: { "01-01": { holiday: true, name: "元旦", date: "2026-01-01" }, ... } }
 *   holiday: true  = 当天放假；holiday: false = 当天补班（周末上班）
 *
 * 只在主进程里跑。取不到（没网 / 该年份还没公布）就原样返回旧缓存，
 * 渲染端拿不到数据时会退回「只算节日当天」的老逻辑，不会显示错误信息。
 */

const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')

const SOURCES = [
  { name: 'ailcc', url: 'https://holiday.ailcc.com/api/holiday/year/' },
  { name: 'timor', url: 'https://timor.tech/api/holiday/year/' }
]
const TIMEOUT = 12000

let cachePath = ''

function init (userDataDir) {
  cachePath = path.join(userDataDir, 'holiday-cache.json')
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
    /* 写不进去就算了，下次还会重新拉 */
  }
}

function getJson (url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'DaysMatterWidget/1.0', 'Accept': 'application/json' }
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error('HTTP ' + res.statusCode))
        return
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (err) { reject(err) }
      })
    })
    req.setTimeout(TIMEOUT, () => { req.destroy(new Error('timeout')) })
    req.on('error', reject)
  })
}

/**
 * 拉一年，依次试两个源。
 * 返回 { days: [{date, holiday, name}], source } ；都拿不到返回 null
 */
async function fetchYear (year) {
  for (const src of SOURCES) {
    try {
      const raw = await getJson(src.url + year)
      if (!raw || raw.code !== 0 || !raw.holiday) continue
      const days = Object.keys(raw.holiday)
        .map((k) => raw.holiday[k])
        .filter((d) => d && d.date)
        .map((d) => ({ date: String(d.date), holiday: !!d.holiday, name: String(d.name || '') }))
        .sort((a, b) => (a.date < b.date ? -1 : 1))
      // 条目太少说明是「成功但没数据」，换下一个源再试
      if (days.length >= 3) return { days, source: src.name }
    } catch (err) {
      /* 这个源不行，试下一个 */
    }
  }
  return null
}

/**
 * 同步指定年份（默认今年 + 明年）。
 * 已经拿到过、且距离上次抓取不到 12 小时的年份会跳过，避免反复请求。
 * 返回 { years, changed }
 */
async function sync (years, force) {
  const cache = loadCache()
  const now = Date.now()
  const changedYears = []

  for (const year of years) {
    const old = cache[year]
    const fresh = !force && old && old.fetchedAt && (now - old.fetchedAt < 12 * 3600 * 1000)
    if (fresh) continue
    try {
      const got = await fetchYear(year)
      if (!got) continue
      cache[year] = { days: got.days, fetchedAt: now, source: got.source }
      changedYears.push(year)
    } catch (err) {
      /* 没网就留着旧数据，不覆盖 */
    }
  }

  if (changedYears.length) {
    cache._updatedAt = now
    const last = cache[changedYears[changedYears.length - 1]]
    cache._source = last && last.source
    saveCache(cache)
  }
  return { years: cache, changed: changedYears }
}

/** 已经缓存过的年份，供界面展示 */
function summary () {
  const cache = loadCache()
  const years = Object.keys(cache).filter((k) => /^\d{4}$/.test(k))
  return {
    years,
    updatedAt: cache._updatedAt || null,
    source: cache._source || SOURCES[0].name
  }
}

module.exports = { init, sync, summary, loadCache, SOURCES }
