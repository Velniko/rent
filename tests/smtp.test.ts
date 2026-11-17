/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import test from 'node:test'
import assert from 'node:assert/strict'
import { saveEmailConfig, getEmailRuntimeConfig, getEmailConfigSummary, type SmtpConfig } from '../src/emailConfig'
import { sendTransactionalEmail } from '../src/notifyChannels'
import { runConnectivityProbes } from '../src/services/connectivity'
import { sendSmtpEmail, verifySmtpConnection } from '../src/services/smtp'
import { setSmtpConnector } from './fixtures/cloudflareSockets'

const config: SmtpConfig = { host: 'smtp.example.com', port: 587, user: 'rental@example.com', password: 'test-only-password', from: '电脑租赁 <sender@example.com>', encryption: 'starttls' }
const email = { to: ['first@example.com', 'second@example.com'], subject: '订单收据：中文测试', text: '租金已支付。\n请查收附件。', html: '<p>租金已支付。</p>', attachments: [{ filename: '收据.pdf', content: 'JVBERi0xLjQ=', contentType: 'application/pdf' }] }

function server(options: { ssl?: boolean; plain?: boolean; plainChallenge?: boolean; login?: boolean; authCode?: number; recipientCode?: number; dataCode?: number; noStarttls?: boolean; disconnect?: boolean; hang?: boolean; closeFails?: boolean } = {}) {
  const commands: Array<{ line: string; tls: boolean }> = []
  const sockets: Socket[] = []
  let data = ''
  let upgrades = 0
  let closed = 0
  function socket(tls: boolean, greeting: boolean): Socket {
    let controller: ReadableStreamDefaultController<Uint8Array>
    let finish!: () => void
    let ended = false
    let authStep = 0
    let expectingData = false
    const reply = (text: string) => {
      const bytes = new TextEncoder().encode(text)
      // Replies intentionally cross packet and line boundaries.
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
    }
    const readable = new ReadableStream<Uint8Array>({ start(value) { controller = value; if (greeting && !options.hang) reply('220-smtp.example.com\r\n220 Ready\r\n') } })
    const result: Socket = {
      readable,
      writable: new WritableStream<Uint8Array>({ write(chunk) {
        const line = new TextDecoder().decode(chunk).replace(/\r\n$/, '')
        commands.push({ line, tls })
        if (options.disconnect) { controller.close(); ended = true; return }
        if (expectingData) { data = line; expectingData = false; reply(`${options.dataCode || 250} Message accepted\r\n`); return }
        if (line.startsWith('EHLO ')) reply(`250-smtp.example.com\r\n${!tls && !options.noStarttls ? '250-STARTTLS\r\n' : ''}250 AUTH ${options.login ? 'LOGIN' : 'PLAIN LOGIN'}\r\n`)
        else if (line === 'STARTTLS') reply('220 Begin TLS\r\n')
        else if (line === 'AUTH LOGIN') { authStep = 1; reply('334 VXNlcm5hbWU6\r\n') }
        else if (authStep === 1) { assert.equal(atob(line), config.user); authStep = 2; reply('334 UGFzc3dvcmQ6\r\n') }
        else if (authStep === 2) { assert.equal(atob(line), config.password); authStep = 0; reply(`${options.authCode || 235} Auth result\r\n`) }
        else if (line.startsWith('AUTH PLAIN ')) { assert.equal(atob(line.slice(11)), `\0${config.user}\0${config.password}`); if (options.plainChallenge) { authStep = 3; reply('334\r\n') } else reply(`${options.authCode || 235} Auth result\r\n`) }
        else if (authStep === 3) { assert.equal(atob(line), `\0${config.user}\0${config.password}`); authStep = 0; reply('235 Authenticated\r\n') }
        else if (line.startsWith('MAIL FROM:')) reply('250 Sender accepted\r\n')
        else if (line.startsWith('RCPT TO:')) reply(`${options.recipientCode || 250} Recipient result\r\n`)
        else if (line === 'DATA') { expectingData = true; reply('354 Send message\r\n') }
        else throw new Error(`Unexpected SMTP command: ${line}`)
      } }),
      opened: Promise.resolve({}), closed: new Promise(resolve => { finish = resolve }), upgraded: false, secureTransport: tls ? 'on' : 'starttls',
      async close() { closed++; if (!ended) { controller.close(); ended = true }; finish(); if (options.closeFails) throw new Error('Closing failed after acceptance') },
      startTls() { assert.equal(readable.locked, false); assert.equal(result.writable.locked, false); upgrades++; return socket(true, false) },
    }
    sockets.push(result)
    return result
  }
  setSmtpConnector((address, socketOptions) => {
    assert.deepEqual(address, { hostname: config.host, port: options.ssl ? 465 : 587 })
    assert.equal(socketOptions?.secureTransport, options.ssl ? 'on' : options.plain ? 'off' : 'starttls')
    return socket(Boolean(options.ssl), true)
  })
  return { commands, sockets, get data() { return data }, get upgrades() { return upgrades }, get closed() { return closed } }
}

async function context() {
  let stored = ''
  const c = { env: { SETTINGS_ENCRYPTION_KEY: 'smtp-test-master-key', RENT: { prepare(sql: string) {
    let value: unknown
    return {
      bind(input: unknown) { value = input; return this },
      async first() { return sql.includes('notificationChannels') ? { value: '{"emailProvider":"smtp"}' } : stored ? { value: stored } : null },
      async run() { stored = String(value); return { success: true } },
    }
  } } } } as any
  await saveEmailConfig(c, config)
  return { c, get stored() { return stored } }
}

for (const ssl of [false, true]) {
  test(`SMTP ${ssl ? 'implicit TLS' : 'STARTTLS'} sends Chinese text, HTML and PDF through the configured transport`, async () => {
    const remote = server({ ssl })
    const { c, stored } = await context()
    if (ssl) await saveEmailConfig(c, { port: 465, encryption: 'ssl' })
    assert.ok(!stored.includes(config.password))
    assert.equal((await getEmailRuntimeConfig(c)).password, config.password)
    assert.equal((await getEmailConfigSummary(c)).configured, true)
    const result = await sendTransactionalEmail(c, email)
    assert.equal(result.ok, true, result.error || '')
    assert.match(result.id!, /^[a-f0-9-]+@example.com$/)
    assert.equal(remote.upgrades, ssl ? 0 : 1)
    assert.equal(remote.commands.filter(item => item.line.startsWith('EHLO ')).length, ssl ? 1 : 2)
    assert.equal(remote.commands.filter(item => item.line.startsWith('AUTH')).every(item => item.tls), true)
    assert.equal(remote.commands.filter(item => item.line.startsWith('RCPT TO:')).length, 2)
    assert.match(remote.data, /Content-Type: multipart\/mixed/)
    assert.match(remote.data, /Content-Type: multipart\/alternative/)
    assert.match(remote.data, /Content-Type: text\/plain; charset=UTF-8/)
    assert.match(remote.data, /Content-Type: text\/html; charset=UTF-8/)
    assert.match(remote.data, /Content-Type: application\/pdf/)
    assert.match(remote.data, /filename\*=UTF-8''%E6%94%B6%E6%8D%AE.pdf/)
    assert.ok(remote.data.includes(Buffer.from(email.subject).toString('base64')))
    assert.ok(remote.data.includes(Buffer.from(email.text).toString('base64')))
    assert.match(remote.data, /JVBERi0xLjQ=/)
    assert.ok(remote.data.endsWith('\r\n.'))
    assert.equal(remote.closed, 1)
  })
}

test('SMTP supports explicitly selected plaintext transport and PLAIN challenges', async () => {
  const remote = server({ plain: true, plainChallenge: true })
  const id = await sendSmtpEmail({ ...config, encryption: 'none' }, email)
  assert.ok(id)
  assert.equal(remote.upgrades, 0)
  assert.ok(remote.commands.some(item => item.line.startsWith('AUTH PLAIN ')))
  assert.equal(remote.commands.filter(item => item.line === Buffer.from(`\0${config.user}\0${config.password}`).toString('base64')).length, 1)
})

test('SMTP connectivity logs in with AUTH LOGIN without submitting any message', async () => {
  const remote = server({ login: true })
  const { c } = await context()
  const [result] = await runConnectivityProbes(c, 'email')
  assert.equal(result.status, 'ok', result.detail)
  assert.equal(result.detail, 'SMTP 连接及认证成功')
  assert.ok(remote.commands.some(item => item.line === 'AUTH LOGIN'))
  assert.ok(remote.commands.every(item => !/^(MAIL FROM|RCPT TO|DATA)/.test(item.line)))
  assert.equal(remote.closed, 1)
})

for (const options of [{ authCode: 535 }, { recipientCode: 550 }, { dataCode: 554 }, { noStarttls: true }, { disconnect: true }]) {
  test(`SMTP reports failure and closes its socket: ${JSON.stringify(options)}`, async () => {
    const remote = server(options)
    const { c } = await context()
    const result = await sendTransactionalEmail(c, email)
    assert.equal(result.ok, false)
    assert.equal(result.id, null)
    assert.ok(result.error)
    assert.ok(!result.error.includes(config.password))
    if (options.noStarttls || options.authCode) assert.ok(!remote.commands.some(item => item.line === 'DATA'))
    if (options.noStarttls) assert.ok(!remote.commands.some(item => item.line.startsWith('AUTH')))
    assert.equal(remote.closed, 1)
  })
}

test('SMTP does not fail an accepted delivery when socket cleanup fails', async () => {
  server({ closeFails: true })
  const { c } = await context()
  assert.equal((await sendTransactionalEmail(c, email)).ok, true)
})

test('SMTP times out and releases an unresponsive socket', async t => {
  const remote = server({ hang: true })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pending = verifySmtpConnection(config)
  // Allow the dynamic runtime import and socket attachment to finish first.
  // A single setImmediate has been observed to not always be enough under
  // CI load, so flush a few more microtask/macrotask turns for safety.
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve))
  // Tick past the 20s timeout with margin rather than exactly at the boundary.
  t.mock.timers.tick(25000)
  await assert.rejects(pending, /SMTP 连接或发送超时/)
  assert.equal(remote.closed, 1)
})

test('SMTP rejects header injection, invalid attachments and port 25 before connecting', async () => {
  let connections = 0
  setSmtpConnector(() => { connections++; throw new Error('Unexpected connection') })
  await assert.rejects(sendSmtpEmail(config, { ...email, subject: 'hello\r\nBcc: other@example.com' }), /邮件头/)
  await assert.rejects(sendSmtpEmail(config, { ...email, to: 'first@example.com\r\nRCPT TO:<other@example.com>' }), /邮件头/)
  await assert.rejects(sendSmtpEmail(config, { ...email, attachments: [{ filename: 'x.pdf', content: 'invalid base64' }] }), /附件内容无效/)
  await assert.rejects(sendSmtpEmail({ ...config, port: 25 }, email), /不支持 SMTP 端口 25/)
  assert.equal(connections, 0)
  const { c } = await context()
  await assert.rejects(saveEmailConfig(c, { port: 25 }), /不支持 SMTP 端口 25/)
  await assert.rejects(saveEmailConfig(c, { port: 'NaN' }), /SMTP 端口无效/)
})
