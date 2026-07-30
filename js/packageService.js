/* ============================================================
   خدمة الباقات الجاهزة — تراث العز
   إدارة الباقات (إنشاء/تعديل/حذف) بصفحة المستودع، والاختيار
   السريع لتطبيق باقة على سلة تسجيل الطلب دفعة وحدة.
   ============================================================ */

/** يحمّل الباقات الجاهزة النشطة + مكوّناتها — تُستخدم كاختصار إدخال بفورم تسجيل الطلب */
async function loadPackages(){
  const [{ data: pkgs, error: e1 }, { data: items, error: e2 }] = await Promise.all([
    sb.from('packages').select('*').eq('is_active', true).order('id'),
    sb.from('package_items').select('*').order('sort_order')
  ]);
  if (e1 || e2){ showToast('تعذّر تحميل الباقات: ' + ((e1||e2).message), true); return; }
  state.packages = pkgs || [];
  state.packageItems = items || [];
  renderPackageQuickButtons();
  renderPackagesList();
}
/** يرسم أزرار الاختيار السريع للباقات فوق سلة المنتجات بفورم تسجيل الطلب */
function renderPackageQuickButtons(){
  const box = document.getElementById('packageQuickButtons');
  if (!box) return;
  if (!state.packages.length){ box.style.display = 'none'; return; }
  box.style.display = 'flex';
  box.innerHTML = state.packages.map(p => `
    <button type="button" class="btn-sm btn-teal" onclick="applyPackageToCart(${p.id})">📦 ${escapeHtml(p.name)}</button>
  `).join('');
}
/** يضيف كل مكوّنات الباقة دفعة وحدة لسلة الطلب الحالية (فوق أي بنود موجودة، ما يمسحها) */
function applyPackageToCart(packageId){
  const pkg = state.packages.find(p => p.id === packageId);
  if (!pkg) return;
  const pkgItems = state.packageItems.filter(pi => pi.package_id === packageId);
  if (!pkgItems.length){ showToast('هذي الباقة ما فيها مكوّنات مسجّلة بعد.', true); return; }
  let sumPrice = 0;
  let addedCount = 0;
  let missing = [];
  pkgItems.forEach(pi => {
    const catalog = pi.item_type === 'service' ? state.services : state.warehouse;
    const info = catalog.find(x => x.name === pi.item_name);
    if (!info){ missing.push(pi.item_name); return; }
    addCartRow(pi.item_type, pi.item_name, Number(pi.qty) || 1, Number(info.price));
    sumPrice += Number(info.price) * (Number(pi.qty) || 1);
    addedCount++;
  });
  if (missing.length){
    showToast('⚠️ تنبيه: هذي الأصناف بالباقة غير موجودة بالقائمة الحالية وتم تجاهلها: ' + missing.join('، '), true);
  }
  if (!addedCount) return;
  // باقة بسعر ثابت: نطبّق خصم تلقائي يعادل الفرق، فقط لو ما فيه خصم مُدخل يدوياً مسبقاً (ما نلغي اختيار الموظف)
  if (pkg.price_mode === 'fixed' && pkg.fixed_price != null){
    const discountValEl = document.getElementById('ordDiscountValue');
    if (!Number(discountValEl.value)){
      const diff = sumPrice - Number(pkg.fixed_price);
      if (diff > 0){
        document.getElementById('ordDiscountType').value = 'fixed';
        discountValEl.value = diff.toFixed(2);
      }
    }
  }
  updateMoneySummary();
  showToast('✅ أُضيفت باقة "' + pkg.name + '" (' + addedCount + ' بنود).');
}

/* ========================= إدارة الباقات الجاهزة (صفحة المستودع) ========================= */
let pkgItemsDraft = []; // [{type:'product'|'service', name, qty}]
function togglePkgFixedPriceField(){
  document.getElementById('pkgFixedPriceWrap').style.display =
    document.getElementById('pkgPriceMode').value === 'fixed' ? 'block' : 'none';
}
function addPkgItemRow(type, name, qty){
  pkgItemsDraft.push({ type: type || 'product', name: name || '', qty: qty || 1 });
  renderPkgItemsRows();
}
function removePkgItemRow(idx){
  pkgItemsDraft.splice(idx, 1);
  renderPkgItemsRows();
}
function updatePkgItemRow(idx, field, value){
  pkgItemsDraft[idx][field] = value;
  if (field === 'type') pkgItemsDraft[idx].name = ''; // نوع تغيّر، نصفّر الاسم عشان يختار من قائمة صحيحة
  renderPkgItemsRows();
}
function renderPkgItemsRows(){
  const el = document.getElementById('pkgItemsRows');
  if (!el) return;
  el.innerHTML = pkgItemsDraft.length ? pkgItemsDraft.map((row, idx) => {
    const list = row.type === 'service' ? state.services : state.warehouse;
    const options = ['<option value="">اختر...</option>'].concat(
      list.map(p => `<option value="${escapeHtml(p.name)}" ${p.name===row.name?'selected':''}>${escapeHtml(p.name)}</option>`)
    ).join('');
    return `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
        <select style="flex:0 0 90px;" onchange="updatePkgItemRow(${idx},'type',this.value)">
          <option value="product" ${row.type==='product'?'selected':''}>منتج</option>
          <option value="service" ${row.type==='service'?'selected':''}>خدمة</option>
        </select>
        <select style="flex:2;" onchange="updatePkgItemRow(${idx},'name',this.value)">${options}</select>
        <input type="number" min="0.01" step="0.01" value="${row.qty}" style="flex:0 0 70px;" onchange="updatePkgItemRow(${idx},'qty',Number(this.value)||1)">
        <button type="button" class="btn-sm btn-ghost" onclick="removePkgItemRow(${idx})">✕</button>
      </div>`;
  }).join('') : '<div class="hint">ما فيه مكوّنات بعد — اضغط "+ أضف مكوّن".</div>';
}
function resetPackageForm(){
  document.getElementById('pkgId').value = '';
  document.getElementById('pkgName').value = '';
  document.getElementById('pkgDescription').value = '';
  document.getElementById('pkgPriceMode').value = 'sum';
  document.getElementById('pkgFixedPrice').value = '';
  togglePkgFixedPriceField();
  pkgItemsDraft = [];
  renderPkgItemsRows();
}
async function savePackage(){
  const name = document.getElementById('pkgName').value.trim();
  if (!name){ showToast('لازم تكتب اسم الباقة.', true); return; }
  if (!pkgItemsDraft.length){ showToast('أضف مكوّن واحد على الأقل للباقة.', true); return; }
  if (pkgItemsDraft.some(r => !r.name)){ showToast('فيه مكوّن بدون اختيار صنف — أكمّله أو احذفه.', true); return; }
  const priceMode = document.getElementById('pkgPriceMode').value;
  const fixedPrice = priceMode === 'fixed' ? (Number(document.getElementById('pkgFixedPrice').value) || 0) : null;
  const id = document.getElementById('pkgId').value;
  showLoading(true);
  try {
    let packageId;
    if (id){
      const { error } = await sb.from('packages').update({
        name, description: document.getElementById('pkgDescription').value.trim(),
        price_mode: priceMode, fixed_price: fixedPrice
      }).eq('id', Number(id));
      if (error) throw error;
      packageId = Number(id);
      const { error: delErr } = await sb.from('package_items').delete().eq('package_id', packageId);
      if (delErr) throw delErr;
    } else {
      const { data, error } = await sb.from('packages').insert({
        name, description: document.getElementById('pkgDescription').value.trim(),
        price_mode: priceMode, fixed_price: fixedPrice
      }).select('id').single();
      if (error) throw error;
      packageId = data.id;
    }
    const rows = pkgItemsDraft.map((r, idx) => ({
      package_id: packageId, item_type: r.type, item_name: r.name, qty: r.qty, sort_order: idx
    }));
    const { error: itemsErr } = await sb.from('package_items').insert(rows);
    if (itemsErr) throw itemsErr;
    showToast('✅ تم حفظ الباقة.');
    resetPackageForm();
    await loadPackages();
  } catch(e){
    showToast('تعذّر حفظ الباقة: ' + e.message, true);
  } finally {
    showLoading(false);
  }
}
function renderPackagesList(){
  const el = document.getElementById('packagesList');
  if (!el) return;
  if (!state.packages.length){ el.innerHTML = '<div class="hint">ما فيه باقات مسجّلة بعد.</div>'; return; }
  el.innerHTML = state.packages.map(p => {
    const items = state.packageItems.filter(i => i.package_id === p.id);
    return `
      <div style="border:1px dashed var(--line);border-radius:8px;padding:10px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <b>📦 ${escapeHtml(p.name)}</b>
          <div style="display:flex;gap:6px;">
            <button class="btn-sm btn-ghost" onclick="editPackage(${p.id})">✏️ تعديل</button>
            <button class="btn-sm btn-ghost" style="color:var(--debt);" onclick="deletePackage(${p.id})">🗑️ حذف</button>
          </div>
        </div>
        <div class="hint" style="margin-top:4px;">${p.price_mode==='fixed' ? ('سعر ثابت: ' + Number(p.fixed_price).toLocaleString() + ' ر.س') : 'مجموع أسعار المكوّنات تلقائياً'}</div>
        <div style="font-size:12.5px;color:var(--muted);margin-top:4px;">${items.map(i=>escapeHtml(i.item_name)+' ×'+i.qty).join('، ') || '—'}</div>
      </div>`;
  }).join('');
}
function editPackage(id){
  const p = state.packages.find(x => x.id === id);
  if (!p) return;
  document.getElementById('pkgId').value = p.id;
  document.getElementById('pkgName').value = p.name || '';
  document.getElementById('pkgDescription').value = p.description || '';
  document.getElementById('pkgPriceMode').value = p.price_mode || 'sum';
  document.getElementById('pkgFixedPrice').value = p.fixed_price || '';
  togglePkgFixedPriceField();
  pkgItemsDraft = state.packageItems.filter(i => i.package_id === id)
    .map(i => ({ type: i.item_type, name: i.item_name, qty: i.qty }));
  renderPkgItemsRows();
  const acc = document.getElementById('accPackageAdd');
  acc.classList.add('open');
  acc.scrollIntoView({behavior:'smooth', block:'start'});
}
async function deletePackage(id){
  if (!confirm('تأكيد حذف هذي الباقة؟ (ما يمس أي طلبات سابقة استخدمتها، بس تختفي من الاختيار السريع)')) return;
  showLoading(true);
  const { error } = await sb.from('packages').delete().eq('id', id);
  showLoading(false);
  if (error){ showToast('تعذّر الحذف: ' + error.message, true); return; }
  showToast('تم الحذف.');
  await loadPackages();
}
