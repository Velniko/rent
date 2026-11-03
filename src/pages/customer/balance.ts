import { clientPathEnabled, normalizeClientAccess } from '../../clientAccess'
import { buildLayout, formatCurrency, formatMelbourneDateTime, getUserById } from '../../site'
import type { Context } from 'hono'

export async function renderCustomerBalance(c: Context, user: any) {
  const rows = (await c.env.RENT.prepare('SELECT * FROM balance_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(user.id).all()).results as any[]
  const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
  const body = `<div class="entity-header"><div class="identity-strip mono"><span>ACCOUNT / LEDGER</span><span>AVAILABLE FUNDS</span></div><div class="entity-heading"><div><p class="section-code">WALLET / ACCOUNT LEDGER</p><h2>账户流水</h2></div><strong class="balance-hero-value">${formatCurrency(user.balance)}</strong></div></div>
    <div class="panel"><div class="section-title"><h3>账户余额明细</h3>${clientPathEnabled(user.clientAccess || normalizeClientAccess(null),'/customer/balance/top-up','console') ? `<a class="button button-secondary" href="/customer/balance/top-up">充值</a>` : ''}</div>${rows.length ? `<table><thead><tr><th>时间（墨尔本）</th><th>项目</th><th>金额</th><th>余额</th></tr></thead><tbody>${rows.map((row: any) => `<tr><td>${esc(formatMelbourneDateTime(row.created_at))}</td><td>${esc(row.reason)}</td><td class="mono ${Number(row.amount) >= 0 ? 'balance-positive' : 'balance-negative'}">${Number(row.amount) >= 0 ? '+' : ''}${formatCurrency(row.amount)}</td><td class="mono">${formatCurrency(row.balance_after)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state"><h3>暂无账户流水</h3><p>充值、租赁付款或退款到账后会显示在这里。</p></div>'}</div>`
  return buildLayout('账户余额 - 电脑租赁管理系统', body, user)
}
