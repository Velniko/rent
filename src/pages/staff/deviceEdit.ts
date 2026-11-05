/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, getDeviceById } from '../../site'
import { escapeHtml } from '../../lib/html';
import type { Context } from 'hono'

export async function renderStaffDeviceEdit(c: Context, user: any, deviceId: string, errorMessage?: string) {
  const device = await getDeviceById(c, deviceId)
  if (!device) {
    return buildLayout('编辑设备 - 电脑租赁管理系统', '<div class="panel"><h2>设备未找到</h2><p>您请求的设备不存在。</p></div>', user)
  }

  const body = `
    <div class="panel">
      <div class="section-title"><h2>编辑设备 - ${escapeHtml(device.name)}</h2></div>
      ${errorMessage ? `<div data-flash-notice class="page-notification page-notification--error">${errorMessage}</div>` : ''}
      <form method="POST" action="/staff/devices/${device.id}/edit">
        <label class="form-label">设备名称</label>
        <input class="form-control" name="name" value="${escapeHtml(device.name)}" />
        <label class="form-label">型号</label>
        <input class="form-control" name="model" value="${escapeHtml(device.model)}" />
        <label class="form-label">设备分类</label>
        <select class="form-control" name="category">${['游戏笔记本','轻薄商务本','台式工作站','普通笔记本','其他'].map(category => `<option value="${category}" ${device.category === category ? 'selected' : ''}>${category}</option>`).join('')}</select>
        <label class="form-label">序列号</label>
        <input class="form-control" name="serialNumber" value="${escapeHtml(device.serialNumber)}" />
        <label class="form-label">日租金</label>
        <input class="form-control" type="number" step="0.01" name="dailyRate" value="${device.dailyRate}" />
        <label class="form-label">周租折扣（%）</label>
        <input class="form-control" type="number" min="0" max="100" step="0.01" name="weeklyDiscountPercent" placeholder="跟随全局" value="${device.weeklyDiscountOverride === null ? '' : device.weeklyDiscountPercent ?? device.weekly_discount_percent ?? 0}" />
        <label class="form-label">月租折扣（%）</label>
        <input class="form-control" type="number" min="0" max="100" step="0.01" name="monthlyDiscountPercent" placeholder="跟随全局" value="${device.monthlyDiscountOverride === null ? '' : device.monthlyDiscountPercent ?? device.monthly_discount_percent ?? 0}" />
        <label class="form-label">设备状态</label>
        <select class="form-control" name="status">
          <option value="available" ${device.status === 'available' ? 'selected' : ''}>可用</option>
          <option value="rented" ${device.status === 'rented' ? 'selected' : ''}>已租借</option>
          <option value="maintenance" ${device.status === 'maintenance' ? 'selected' : ''}>维护中</option>
          <option value="retired" ${device.status === 'retired' ? 'selected' : ''}>已退役</option>
        </select>
        <label class="form-label" for="demoMode"><input type="checkbox" role="switch" id="demoMode" name="demoMode" value="1" ${device.demo_available_from || device.demoAvailableFrom ? 'checked' : ''}> 演示</label>
        <button class="button button-primary" type="submit" style="margin-top: 20px;">保存修改</button>
      </form>
    </div>
  `
  return buildLayout('编辑设备 - 电脑租赁管理系统', body, user)
}
