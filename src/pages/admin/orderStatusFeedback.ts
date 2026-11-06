/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

export function renderOrderStatusFeedback(): string {
  return `
    <dialog class="feedback-dialog" data-order-status-dialog aria-labelledby="order-status-dialog-title">
      <div class="feedback-dialog-icon" aria-hidden="true">!</div>
      <h3 id="order-status-dialog-title">订单状态更新失败</h3>
      <p data-order-status-error>暂时无法更新订单状态，请稍后重试。</p>
      <button class="button button-primary" type="button" data-close-dialog>知道了</button>
    </dialog>
    <script>
      (() => {
        const dialog = document.querySelector('[data-order-status-dialog]');
        const errorText = dialog.querySelector('[data-order-status-error]');
        const showError = (message) => {
          errorText.textContent = message || '暂时无法更新订单状态，请稍后重试。';
          if (typeof dialog.showModal === 'function') window.WorkspaceMotion.open(dialog);
          else if (window.siteToast) window.siteToast(errorText.textContent, 'error');
          else window.alert(errorText.textContent);
        };
        document.querySelectorAll('.js-order-status-form').forEach((form) => {
          const submitForm = async () => {
            const button = form.querySelector('button[type="submit"]');
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            try {
              const response = await fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
              });
              const payload = await response.json().catch(() => ({}));
              if (!response.ok || !payload.ok) throw new Error(payload.error || '订单状态更新失败，请刷新后重试。');
              window.location.reload();
            } catch (error) {
              showError(error instanceof Error ? error.message : '订单状态更新失败，请稍后重试。');
              button.disabled = false;
              button.removeAttribute('aria-busy');
            }
          };
          form.addEventListener('submit', (event) => {
            event.preventDefault();
            if (form.dataset.forceConfirm === 'true') {
              window.siteConfirm('将跳过归还验机并强制将此订单标记为已完成。此操作会释放设备，且不能撤销。请先核实设备和订单状态。', () => {
                form.dataset.forceConfirm = 'false';
                try { form.requestSubmit(); } finally { form.dataset.forceConfirm = 'true'; }
              }, { danger: true, title: '强制完成订单？', confirmLabel: '强制完成订单', requireText: '完成订单' });
              return;
            }
            const statusField = form.querySelector('[name="status"]');
            if (statusField && ['suspended', 'cancelled'].includes(statusField.value) && !form.querySelector('[name="reason"]')) {
              window.sitePrompt('请填写暂停/取消原因，原因会随站内通知和邮件发送给客户。', (reason) => {
                const hidden = document.createElement('input');
                hidden.type = 'hidden';
                hidden.name = 'reason';
                hidden.value = reason.slice(0, 300);
                form.appendChild(hidden);
                submitForm();
              }, {
                danger: statusField.value === 'cancelled',
                title: statusField.value === 'cancelled' ? '取消订单？' : '暂停租赁？',
                label: statusField.value === 'cancelled' ? '取消原因（必填）' : '暂停原因（必填）',
                placeholder: '例如：客户申请 / 设备无货 / 订单信息有误',
                confirmLabel: statusField.value === 'cancelled' ? '确认取消订单' : '确认暂停',
                maxLength: 300,
              });
              return;
            }
            submitForm();
          });
        });
      })();
    </script>`
}
