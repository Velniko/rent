/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout } from '../../site';

export function renderStaffDeviceNew(user: any, errorMessage?: string) {
  const body = `
    <div class="panel">
      <div class="section-title"><h2>添加新设备</h2></div>
      ${errorMessage ? `<div data-flash-notice class="page-notification page-notification--error">${errorMessage}</div>` : ''}
      <form method="POST" action="/staff/devices/new">
        <label class="form-label">设备名称</label>
        <input class="form-control" name="name" placeholder="例如：MacBook Pro 16寸" />
        <label class="form-label">型号</label>
        <input class="form-control" name="model" placeholder="例如：M1 Max" />
        <label class="form-label">设备分类</label>
        <select class="form-control" name="category"><option value="游戏笔记本">游戏笔记本</option><option value="轻薄商务本">轻薄商务本</option><option value="台式工作站">台式工作站</option><option value="普通笔记本">普通笔记本</option><option value="其他" selected>其他</option></select>
        <label class="form-label">序列号</label>
        <input class="form-control" name="serialNumber" placeholder="设备的唯一序列号" />
        <label class="form-label">日租金</label>
        <input class="form-control" type="number" step="0.01" name="dailyRate" placeholder="例如：50.00" />
        <label class="form-label">周租折扣（%）</label>
        <input class="form-control" type="number" min="0" max="100" step="0.01" name="weeklyDiscountPercent" value="" placeholder="跟随全局" />
        <label class="form-label">月租折扣（%）</label>
        <input class="form-control" type="number" min="0" max="100" step="0.01" name="monthlyDiscountPercent" value="" placeholder="跟随全局" />
        <label class="form-label">设备状态</label>
        <select class="form-control" name="status">
          <option value="available">可用</option>
          <option value="rented">已租借</option>
          <option value="maintenance">维护中</option>
          <option value="retired">已退役</option>
        </select>
        <label class="form-label" for="demoMode"><input type="checkbox" role="switch" id="demoMode" name="demoMode" value="1"> 演示</label>
        <button class="button button-primary" type="submit" style="margin-top: 20px;">添加设备</button>
      </form>
    </div>
  `
  return buildLayout('添加新设备 - 电脑租赁管理系统', body, user)
}
