/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import { buildLayout } from '../../site'

export function renderAdminDeviceNew(user: any, errorMessage = '', registrationKey = '') {
  const body = `
    <div class="page-header"><div><p class="section-code">ASSET INTAKE</p><h2>添加入库设备</h2></div><a href="/admin/devices" class="button button-secondary">返回设备列表</a></div>
    <div class="panel">
      ${errorMessage ? `<div ${registrationKey ? '' : 'data-flash-notice'} class="page-notification page-notification--${registrationKey ? 'success' : 'error'}">${errorMessage}${registrationKey ? `<p class="mono" style="font-size:1.1rem;user-select:all;word-break:break-all;"><strong>${registrationKey}</strong></p><small>此密钥只显示这一次，请立即复制并交给 Windows 设备代理。</small>` : ''}</div>` : ''}<form method="POST" action="/admin/devices/new" class="asset-editor">
        <section class="form-section"><div class="form-section-title"><span class="mono">ID</span><div><h3>设备身份</h3></div></div>
          <div class="grid grid-2">
            <div class="form-group"><label class="form-label" for="name">设备名称</label><input class="form-control" id="name" name="name" required maxlength="120" placeholder="例如 MacBook Pro 14"></div>
            <div class="form-group"><label class="form-label" for="brand">品牌</label><div class="brand-entry"><input class="form-control" id="brand" name="brand" required maxlength="120" placeholder="例如 Apple" autocomplete="off"><span class="brand-logo" id="brandLogo" aria-hidden="true"></span><div class="brand-suggestions" id="brandSuggestions" role="listbox" aria-label="品牌选项"></div></div></div>
            <div class="form-group"><label class="form-label" for="model">型号</label><input class="form-control" id="model" name="model" required maxlength="120" placeholder="例如 A2918 / Mac15,6"></div>
            <div class="form-group"><label class="form-label" for="category">设备分类</label><select class="form-control" id="category" name="category"><option value="游戏笔记本">游戏笔记本</option><option value="轻薄商务本">轻薄商务本</option><option value="台式工作站">台式工作站</option><option value="普通笔记本">普通笔记本</option><option value="其他" selected>其他</option></select></div>
            <div class="form-group"><label class="form-label" for="assetTag">资产编号</label><input class="form-control mono" id="assetTag" value="保存后由系统自动生成" disabled><small class="form-text">资产编号由系统按品牌自动生成，不可手动填写。</small></div>
            <div class="form-group"><label class="form-label" for="remark">备注</label><input class="form-control" id="remark" name="remark" maxlength="200"></div>
            <div class="form-group"><label class="form-label" for="serialNumber">序列号</label><input class="form-control mono" id="serialNumber" name="serialNumber" required maxlength="120" placeholder="设备唯一序列号"></div>
            <div class="form-group"><label class="form-label" for="status">初始状态</label><select class="form-control" id="status" name="status"><option value="available">可用</option><option value="maintenance">维修中</option><option value="rented">已出租</option><option value="retired">已退役</option></select></div>
            <div class="form-group"><label class="form-label" for="demoMode"><input type="checkbox" role="switch" id="demoMode" name="demoMode" value="1"> 演示</label></div>
          </div>
        </section>
        <section class="form-section"><div class="form-section-title"><span class="mono">SPEC</span><div><h3>硬件配置</h3></div></div>
          <div class="grid grid-2">
            <div class="form-group"><label class="form-label" for="cpu">CPU</label><input class="form-control" id="cpu" name="cpu" maxlength="200" placeholder="例如 Apple M3 Pro 12-core"></div>
            <div class="form-group"><label class="form-label" for="ram">内存</label><input class="form-control" id="ram" name="ram" maxlength="200" placeholder="例如 18GB"></div>
            <div class="form-group"><label class="form-label" for="storage">存储</label><input class="form-control" id="storage" name="storage" maxlength="200" placeholder="例如 512GB SSD"></div>
            <div class="form-group"><label class="form-label" for="gpu">显卡</label><input class="form-control" id="gpu" name="gpu" maxlength="200" placeholder="例如 18-core GPU"></div>
            <div class="form-group"><label class="form-label" for="os">操作系统</label><input class="form-control" id="os" name="os" maxlength="200" placeholder="例如 macOS 15"></div>
          </div>
          <div class="form-group"><label class="form-label" for="description">补充描述</label><textarea class="form-control" id="description" name="description" rows="4" maxlength="2000" placeholder="屏幕尺寸、接口、外观或其他需要员工了解的信息"></textarea></div>
        </section>
        <section class="form-section"><div class="form-section-title"><span class="mono">AUD</span><div><h3>租赁价格</h3></div></div>
          <div class="grid grid-2"><div class="form-group"><label class="form-label" for="pricePerDay">日租金（AUD）</label><input class="form-control" type="number" id="pricePerDay" name="pricePerDay" min="0" step="0.01" required></div><div class="form-group"><label class="form-label" for="depositAmount">押金（AUD）</label><input class="form-control" type="number" id="depositAmount" name="depositAmount" min="0" step="0.01" required></div><div class="form-group"><label class="form-label" for="weeklyDiscountPercent">周租折扣（%）</label><input class="form-control" type="number" id="weeklyDiscountPercent" name="weeklyDiscountPercent" min="0" max="100" step="0.01" value="" placeholder="跟随全局"><small class="form-text">留空跟随全局；0 为不打折。</small></div><div class="form-group"><label class="form-label" for="monthlyDiscountPercent">月租折扣（%）</label><input class="form-control" type="number" id="monthlyDiscountPercent" name="monthlyDiscountPercent" min="0" max="100" step="0.01" value="" placeholder="跟随全局"><small class="form-text">留空跟随全局；0 为不打折。</small></div></div>
        </section>
        <div class="record-actions"><a href="/admin/devices" class="button button-secondary">取消</a><button type="submit" class="button button-primary">保存并入库</button></div>
      </form>
    </div><script>(()=>{const input=document.getElementById('brand'),logo=document.getElementById('brandLogo'),menu=document.getElementById('brandSuggestions');const brands=['Apple','Dell','HP','Lenovo','ASUS','Acer','Microsoft','Razer','Samsung','LG','Huawei','Xiaomi','MSI','Gigabyte','Framework','Toshiba','Fujitsu','Sony','Panasonic','Google','Logitech','Corsair','Intel','AMD','NVIDIA'];const domains={apple:'apple.com',dell:'dell.com',hp:'hp.com',lenovo:'lenovo.com',asus:'asus.com',acer:'acer.com',microsoft:'microsoft.com',razer:'razer.com',samsung:'samsung.com',lg:'lg.com',huawei:'huawei.com',xiaomi:'mi.com',msi:'msi.com',gigabyte:'gigabyte.com',framework:'frame.work',toshiba:'toshiba.com',fujitsu:'fujitsu.com',sony:'sony.com',panasonic:'panasonic.com',google:'google.com',logitech:'logitech.com',corsair:'corsair.com',intel:'intel.com',amd:'amd.com',nvidia:'nvidia.com'};const updateLogo=()=>{const name=input.value.trim(),domain=domains[name.toLowerCase()];logo.textContent=name.slice(0,2).toUpperCase()||'BR';logo.style.backgroundImage=domain?'url(https://www.google.com/s2/favicons?domain='+domain+'&sz=64)':'';logo.classList.toggle('has-image',Boolean(domain));};const render=()=>{const q=input.value.trim().toLowerCase(),matches=brands.filter(b=>!q||b.toLowerCase().includes(q));menu.innerHTML=matches.map(b=>'<button type="button" role="option" tabindex="-1" data-brand="'+b+'"><span>'+b+'</span><small>'+b.slice(0,2).toUpperCase()+'</small></button>').join('');menu.classList.toggle('is-open',document.activeElement===input&&matches.length>0);menu.querySelectorAll('button').forEach(b=>b.addEventListener('mousedown',e=>{e.preventDefault();input.value=b.dataset.brand;updateLogo();menu.classList.remove('is-open');}));};input.addEventListener('input',()=>{updateLogo();render();});input.addEventListener('focus',render);input.addEventListener('blur',()=>setTimeout(()=>menu.classList.remove('is-open'),120));updateLogo();})();</script>`
  return buildLayout('添加入库设备 - 电脑租赁管理系统', body, user)
}
