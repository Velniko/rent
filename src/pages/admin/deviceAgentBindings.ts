/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, getDevices, sanitizePlainText, formatMelbourneDateTime } from '../../site'

export async function renderAdminDeviceAgentBindings(c: any, user: any, monitorApi: { monitorApiConfigured?: boolean, newMonitorApiToken?: string } = {}) {
  const devices = await getDevices(c)
  const now = Date.now()
  const esc = (value: unknown) => sanitizePlainText(String(value ?? '—'), 200)
  const isOnline = (device: any) => {
    const value = String(device.agent_last_seen_at || '')
    const timestamp = new Date(value.includes('T') || value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`).getTime()
    return Boolean(device.agent_token_hash) && Number.isFinite(timestamp) && now - timestamp <= 5 * 60 * 1000
  }
  const status = (device: any) => isOnline(device) ? '在线' : device.agent_token_hash ? '离线' : '未绑定'
  const onlineCount = devices.filter(isOnline).length
  const boundCount = devices.filter((device: any) => device.agent_token_hash).length
  const pendingCount = devices.filter((device: any) => device.agent_setup_code_expires_at && new Date(device.agent_setup_code_expires_at).getTime() > now).length
  const rows = devices.map((device: any) => {
    const expiry = device.agent_setup_code_expires_at ? new Date(device.agent_setup_code_expires_at).getTime() : 0
    const codeStatus = expiry > now ? '待输入' : device.agent_setup_code_hash ? '已过期' : '—'
    const statusClass = isOnline(device) ? 'badge-success' : device.agent_token_hash ? 'badge-warning' : 'badge-neutral'
    return `<tr><td><strong>${esc(device.name)}</strong><br><small class="mono">${esc(device.model)}</small></td><td class="mono">网站：${esc(device.serialNumber || device.serial_number)}<br>本机：${esc(device.agent_detected_serial || '未上报')}</td><td><span class="badge ${statusClass}">${status(device)}</span><br><small class="mono">${esc(device.agent_version || '版本未知')}</small></td><td>${device.agent_registered_at ? esc(formatMelbourneDateTime(device.agent_registered_at)) : '未注册'}</td><td>${codeStatus}</td><td><div class="record-actions record-actions--compact"><a class="button button-sm button-secondary" data-full-navigation="true" href="/admin/devices/${encodeURIComponent(device.id)}/agent-install">${device.agent_token_hash ? '已绑定' : device.agent_setup_code_hash ? '重新生成访问码' : '生成访问码'}</a><a class="button button-sm button-primary" data-full-navigation="true" href="/admin/devices/${encodeURIComponent(device.id)}/control">远程控制</a><a class="button button-sm button-secondary" data-full-navigation="true" href="/admin/devices/${encodeURIComponent(device.id)}/edit">查看设备</a>${device.agent_token_hash ? `<form method="post" action="/admin/device-agent-bindings/${encodeURIComponent(device.id)}/unbind" style="display:inline" data-site-confirm="解绑后 EXE 可以被卸载或删除，设备将失去当前绑定关系。请确认设备无误。" data-confirm-variant="danger" data-confirm-title="解绑设备？" data-confirm-label="解绑设备"><button class="button button-sm button-danger" type="submit">解绑</button></form>` : ''}</div></td></tr>`
  }).join('')

  const body = `<div class="page-header"><div><p class="section-code">WINDOWS AGENT / CONTROL DESK</p><h2>绑定设备</h2><p>访问码 15 分钟内有效，绑定后失效。</p></div><div class="record-actions"><a class="button button-primary" href="/downloads/RentDeviceAgent-Setup.exe">下载 Windows 客户端</a><a class="button button-secondary" href="/admin/devices">设备管理</a></div></div><div class="grid grid-3" style="margin-bottom:20px"><div class="panel"><span class="section-note">在线设备</span><strong style="display:block;font-size:30px;margin-top:8px">${onlineCount}</strong></div><div class="panel"><span class="section-note">已绑定</span><strong style="display:block;font-size:30px;margin-top:8px">${boundCount}</strong></div><div class="panel"><span class="section-note">待输入访问码</span><strong style="display:block;font-size:30px;margin-top:8px">${pendingCount}</strong><small class="section-note">15 分钟内有效</small></div></div><div class="panel"><div class="section-title"><div><p class="section-code">QUICK ACTIONS</p><h3>软件快捷操作</h3></div><a class="button button-sm button-secondary" href="/admin/device-agent-bindings">刷新状态</a></div><div class="record-actions"><a class="button button-primary" href="/downloads/RentDeviceAgent-Setup.exe">下载最新安装程序</a><a class="button button-secondary" href="https://github.com/Velniko/rent-app/releases" target="_blank" rel="noopener">查看版本更新</a><a class="button button-secondary" href="/admin/devices">选择设备</a></div></div><div class="panel"><div class="section-title"><div><p class="section-code">DEVICE ROSTER</p><h3>客户端设备</h3></div><span class="section-note">共 ${devices.length} 台设备</span></div><div class="table-wrapper"><table><thead><tr><th>设备</th><th>序列号</th><th>客户端状态</th><th>绑定时间</th><th>访问码</th><th>快捷操作</th></tr></thead><tbody>${rows || '<tr><td colspan="6">暂无设备。请先在设备管理中创建设备。</td></tr>'}</tbody></table></div></div>`
  return buildLayout('Windows 客户端绑定设备 - 电脑租赁管理系统', body, user)
}
