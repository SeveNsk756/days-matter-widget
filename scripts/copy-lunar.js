'use strict'
/**
 * 把 npm 包里的 lunar-javascript 复制到 renderer/lib/lunar.js。
 * 仓库里不存这个 426 KB 的第三方产物，克隆后跑一次 npm run prepare-assets 就有了。
 */
const fs = require('fs')
const path = require('path')

const src = require.resolve('lunar-javascript')
const dest = path.join(__dirname, '..', 'renderer', 'lib', 'lunar.js')

fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.copyFileSync(src, dest)

const kb = (fs.statSync(dest).size / 1024).toFixed(1)
console.log('lunar.js -> ' + dest + ' (' + kb + ' KB)')
