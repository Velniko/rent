/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

// 开票 / 收据 / 交易流水 + 退款贷记单。GST 由公司设置决定是否价内含税；
// 收据与交易由已 paid 的 payments 派生。依赖 db（订单 / 合同）、settings、
// lib（编号、JSON）。

import type { Context } from 'hono'
import { generateReferenceNumber } from '../lib/reference'
import { safeJsonParse } from '../lib/json'
import { getSystemSettings } from '../settings/systemSettings'
import { getOrderById, getContractByOrderId } from '../db/repositories'
import { sendPaymentCompletedEmail } from './notifications'

export async function issueInvoice(c: Context, orderId: string): Promise<void> {
  const order = await getOrderById(c, orderId)
  if (!order) return
  const contract = await getContractByOrderId(c, orderId)
  const data = contract && typeof contract.contract_data === 'string' ? (safeJsonParse<Record<string, unknown>>(contract.contract_data) || {}) : ((contract?.contract_data as Record<string, unknown>) || {})
  // Keep the rental line at its original price. The coupon is shown as a
  // separate deduction on the receipt, while the payable total stays lower.
  const discountAmount = Math.max(0, Number((order as any).discountAmount || (order as any).discount_amount || 0))
  const monthlyPaid = order.billing_mode === 'MONTHLY' ? await c.env.RENT.prepare("SELECT COALESCE(SUM(rental_amount), 0) AS rental, COALESCE(SUM(deposit_amount), 0) AS deposit, COALESCE(SUM(processing_fee), 0) AS fee FROM payments WHERE rental_id = ? AND status = 'paid'").bind(order.id).first() as any : null
  const taxableGross = Math.max(0, Number(monthlyPaid?.rental ?? Number(order.totalAmount) - Number(order.depositAmount) + discountAmount))
  const gstAmount = getSystemSettings().companyDetails.gstIncluded ? taxableGross / 11 : 0
  const payment = await c.env.RENT.prepare("SELECT processing_fee, status FROM payments WHERE rental_id = ? AND (status = 'paid' OR (status = 'pending' AND stripe_payment_intent_id = ? AND ? = 'PREAUTH' AND ? IN ('HELD', 'REFUND_PENDING'))) AND COALESCE(rental_amount, 0) > 0 ORDER BY paid_at DESC LIMIT 1").bind(order.id, order.stripe_deposit_payment_intent_id || '', order.deposit_payment_mode || '', order.deposit_status || '').first() as any
  const processingFee = Math.max(0, Number(monthlyPaid?.fee ?? payment?.processing_fee ?? 0))
  const settledAuthorization = order.deposit_payment_mode === 'PREAUTH' && order.refundMethod === 'original' && order.status === 'completed' && ['REFUNDED', 'PARTIALLY_DEDUCTED', 'FORFEITED'].includes(String(order.deposit_status))
  const invoiceDeposit = Number(monthlyPaid?.deposit ?? (settledAuthorization ? Number(order.deposit_deduction_amount || 0) : Number(order.depositAmount)))
  const invoiceTotal = (monthlyPaid ? Number(monthlyPaid.rental) : Number(order.totalAmount) - Number(order.depositAmount)) + invoiceDeposit + processingFee
  const invoiceId = `inv-${order.id}`
  const existing = await c.env.RENT.prepare('SELECT invoice_number, receipt_number FROM invoices WHERE id = ?').bind(invoiceId).first() as any
  const invoiceNumber = existing?.invoice_number || (/^INV-[0-9]{8}-[A-Z0-9]{6}$/.test(String(data.invoice_number || '')) ? String(data.invoice_number) : generateReferenceNumber('INV'))
  const receiptNumber = existing?.receipt_number || (/^RCP-[0-9]{8}-[A-Z0-9]{6}$/.test(String(data.receipt_number || '')) ? String(data.receipt_number) : generateReferenceNumber('RCP'))
  // 授权时可开票；实际捕获后才开付款收据并发送付款成功邮件。
  const existingReceipt = await c.env.RENT.prepare('SELECT id FROM receipts WHERE order_id = ?').bind(order.id).first()
  await c.env.RENT.prepare(`INSERT INTO invoices (id, invoice_number, receipt_number, order_id, type, subtotal, gst_amount, deposit_amount, processing_fee, total_amount, currency, status) VALUES (?, ?, ?, ?, 'invoice', ?, ?, ?, ?, ?, 'AUD', 'issued') ON CONFLICT(id) DO UPDATE SET invoice_number = excluded.invoice_number, receipt_number = excluded.receipt_number, subtotal = excluded.subtotal, gst_amount = excluded.gst_amount, deposit_amount = excluded.deposit_amount, processing_fee = excluded.processing_fee, total_amount = excluded.total_amount, status = 'issued'`)
    .bind(invoiceId, invoiceNumber, receiptNumber, order.id, taxableGross - gstAmount, gstAmount, invoiceDeposit, processingFee, invoiceTotal).run()
  await ensureReceiptAndTransactions(c, order, invoiceId)
  if (payment?.status === 'paid' && !existingReceipt) {
    try { await sendPaymentCompletedEmail(c, order, contract) }
    catch (error: any) { console.error('sendPaymentCompletedEmail failed:', error?.message || error) }
  }
}

async function ensureFinanceTables(c: Context): Promise<void> {
  await c.env.RENT.batch([
    c.env.RENT.prepare(`CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY NOT NULL, transaction_number TEXT NOT NULL UNIQUE,
      order_id TEXT, customer_id TEXT, invoice_id TEXT, transaction_type TEXT NOT NULL,
      payment_method TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'AUD',
      status TEXT NOT NULL DEFAULT 'PENDING', provider TEXT, provider_transaction_id TEXT,
      provider_reference TEXT, description TEXT, metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT, created_by TEXT
    )`),
    c.env.RENT.prepare(`CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY NOT NULL, receipt_number TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL,
      invoice_id TEXT, customer_id TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'AUD',
      subtotal REAL NOT NULL DEFAULT 0, gst_amount REAL NOT NULL DEFAULT 0,
      deposit_amount REAL NOT NULL DEFAULT 0, discount_amount REAL NOT NULL DEFAULT 0,
      total_paid REAL NOT NULL DEFAULT 0, issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'issued', document_url TEXT, document_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    c.env.RENT.prepare(`CREATE TABLE IF NOT EXISTS receipt_transactions (
      receipt_id TEXT NOT NULL, transaction_id TEXT NOT NULL,
      PRIMARY KEY (receipt_id, transaction_id)
    )`),
  ])
}

function financePaymentMethod(method: unknown): string {
  if (method === 'card') return 'CARD'
  if (method === 'bank_transfer') return 'BANK_TRANSFER'
  if (method === 'balance') return 'ACCOUNT_BALANCE'
  return String(method || 'OTHER').toUpperCase()
}

async function ensureReceiptAndTransactions(c: Context, order: any, invoiceId: string): Promise<void> {
  await ensureFinanceTables(c)
  const invoice = await c.env.RENT.prepare('SELECT * FROM invoices WHERE id = ?').bind(invoiceId).first() as any
  if (!invoice) return
  const payments = (await c.env.RENT.prepare("SELECT * FROM payments WHERE rental_id = ? AND status = 'paid' ORDER BY paid_at ASC, created_at ASC").bind(order.id).all()).results as any[]
  if (!payments.length) return
  const receiptId = `rcpt-${order.id}`
  const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  await c.env.RENT.prepare(`INSERT INTO receipts (id, receipt_number, order_id, invoice_id, customer_id, currency, subtotal, gst_amount, deposit_amount, discount_amount, total_paid, status, document_url)
    VALUES (?, ?, ?, ?, ?, 'AUD', ?, ?, ?, ?, ?, 'issued', ?)
    ON CONFLICT(id) DO UPDATE SET receipt_number = excluded.receipt_number, invoice_id = excluded.invoice_id,
      subtotal = excluded.subtotal, gst_amount = excluded.gst_amount, deposit_amount = excluded.deposit_amount,
      discount_amount = excluded.discount_amount, total_paid = excluded.total_paid, status = 'issued', document_url = excluded.document_url`)
    .bind(receiptId, String(invoice.receipt_number), order.id, invoiceId, order.userId, Number(invoice.subtotal || 0), Number(invoice.gst_amount || 0), Number(invoice.deposit_amount || 0), order.billing_mode === 'MONTHLY' ? 0 : Math.max(0, Number(order.discountAmount || order.discount_amount || 0)), paidTotal, `/orders/${order.id}/invoice`).run()

  for (const payment of payments) {
    const transactionNumber = /^TXN-[0-9]{8}-[A-Z0-9]{6}$/.test(String(payment.transaction_id || ''))
      ? String(payment.transaction_id)
      : generateReferenceNumber('TXN')
    if (payment.transaction_id !== transactionNumber) {
      await c.env.RENT.prepare('UPDATE payments SET transaction_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(transactionNumber, payment.id).run()
    }
    const transactionId = `txn-${payment.id}`
    await c.env.RENT.prepare(`INSERT OR IGNORE INTO transactions
      (id, transaction_number, order_id, customer_id, invoice_id, transaction_type, payment_method, amount, currency, status, provider, provider_transaction_id, description, completed_at)
      VALUES (?, ?, ?, ?, ?, 'RENTAL_PAYMENT', ?, ?, ?, 'SUCCESS', ?, ?, '租赁订单付款', CURRENT_TIMESTAMP)`)
      .bind(transactionId, transactionNumber, order.id, order.userId, invoiceId, financePaymentMethod(payment.payment_method), Number(payment.amount || 0), String(payment.currency || 'AUD').toUpperCase(), payment.payment_provider === 'square' ? 'SQUARE' : payment.payment_method === 'card' ? 'STRIPE' : null, payment.payment_provider === 'square' ? payment.square_payment_id || null : payment.stripe_payment_intent_id || null).run()
    await c.env.RENT.prepare('INSERT OR IGNORE INTO receipt_transactions (receipt_id, transaction_id) VALUES (?, ?)').bind(receiptId, transactionId).run()
  }
}

export async function issueCreditNote(c: Context, orderId: string, amount: number, refundedProcessingFee = 0, refundKey = orderId): Promise<void> {
  const invoice = await c.env.RENT.prepare("SELECT id, invoice_number FROM invoices WHERE order_id = ? AND type = 'invoice'").bind(orderId).first() as any
  if (!invoice) return
  const creditNoteNumber = generateReferenceNumber('CN')
  await c.env.RENT.prepare(`INSERT OR IGNORE INTO invoices (id, invoice_number, order_id, type, subtotal, gst_amount, deposit_amount, processing_fee, total_amount, currency, status, related_invoice_id) VALUES (?, ?, ?, 'credit_note', ?, 0, 0, ?, ?, 'AUD', 'issued', ?)`)
    .bind(`cn-${refundKey}`, creditNoteNumber, orderId, -Math.abs(amount), -Math.abs(refundedProcessingFee), -(Math.abs(amount) + Math.abs(refundedProcessingFee)), invoice.id).run()
  await c.env.RENT.prepare("UPDATE invoices SET invoice_number = ? WHERE id = ? AND type = 'credit_note' AND invoice_number LIKE 'CN-INV-%'")
    .bind(creditNoteNumber, `cn-${refundKey}`).run()
}
