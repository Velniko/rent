/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout, getDevices, formatCurrency, sanitizePlainText } from '../../site';
import type { Context } from 'hono';

export async function renderCustomerDevices(c: Context, user: any) {
  const devices = (await getDevices(c)).filter(device => device.status === 'available'); // 只显示可用设备

  const body = `
    <div class="panel">
      <div class="section-title"><h2>设备租赁</h2></div>
      ${devices.length ? `
        <div class="device-list grid grid-3">
          ${devices.map(device => `
            <div class="device-card card">
              <h3 data-api-translate data-i18n-ignore>${sanitizePlainText(device.name, 200)}</h3>
              <p>分类: ${device.category || '其他'}</p>
              <p>型号: ${device.model}</p>
              <p>日租金: ${formatCurrency(device.pricePerDay ?? device.dailyRate ?? 0)}</p>
              <p>押金: ${formatCurrency(device.depositAmount)}</p>
              <a class="button button-primary" href="/customer/rent/${device.id}">立即租赁</a>
            </div>
          `).join('')}
        </div>
      ` : '<p>暂无可用设备。</p>'}
    </div>
  `;

  return buildLayout('设备租赁 - 电脑租赁管理系统', body, user);
}
