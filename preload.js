'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('cfg:get'),
  saveConfig: (patch) => ipcRenderer.invoke('cfg:save', patch),

  dragStart: () => ipcRenderer.send('drag:start'),
  dragEnd: () => ipcRenderer.send('drag:end'),

  nextEvent: (step) => ipcRenderer.invoke('event:step', step),
  setCurrent: (id) => ipcRenderer.invoke('event:current', id),

  openMenu: () => ipcRenderer.send('menu:popup'),
  openSettings: () => ipcRenderer.send('settings:open'),
  quit: () => ipcRenderer.send('app:quit'),

  winMinimize: () => ipcRenderer.send('win:minimize'),
  winToggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
  winClose: () => ipcRenderer.send('win:close'),
  onWinStateChanged: (cb) => {
    const handler = (_evt, isMax) => cb(isMax)
    ipcRenderer.on('win:stateChanged', handler)
    return () => ipcRenderer.removeListener('win:stateChanged', handler)
  },

  syncHolidays: () => ipcRenderer.invoke('holiday:sync'),
  holidayStatus: () => ipcRenderer.invoke('holiday:status'),

  onConfigChanged: (cb) => {
    const handler = (_evt, config) => cb(config)
    ipcRenderer.on('cfg:changed', handler)
    return () => ipcRenderer.removeListener('cfg:changed', handler)
  }
})
