/* ============================================================
   خدمة التغليف — تراث العز
   قواعد استهلاك مستلزمات التغليف المرتبط بالطلبات (عامة/لمنتج معيّن)،
   وربط آمن بحفظ الطلب عبر نداء تابع (بدون تعديل fn_save_order).
   ============================================================ */

/** يحمّل كل قواعد التغليف المفعّلة */
async function loadPackagingRules(){
  const { data, error } = await sb.from('packaging_rules').select('*').eq('is_active', true);
  if (error){ showToast('تعذّر تحميل قواعد التغليف: ' + error.message, true); return; }
  state.packagingRules = data || [];
  renderPackagingRulesList();
}

/** يحسب احتياج كل صنف تغليف لمجموعة بنود طلب معيّنة، حسب القواعد المفعّلة حالياً
 *  @returns {Object} packaging_item_id -> qty */
function computePackagingNeeds(items){
  const needs = {};
  if (!items || !items.length) return needs;
  (state.packagingRules || []).forEach(rule => {
    if (rule.rule_type === 'per_order'){
      needs[rule.packaging_item_id] = (needs[rule.packaging_item_id] || 0) + Number(rule.qty_per_unit);
    } else if (rule.rule_type === 'per_product'){
      const matchQty = items
        .filter(it => (it.name || it.product) === rule.linked_product_name)
        .reduce((s, it) => s + Number(it.qty || 0), 0);
      if (matchQty > 0){
        needs[rule.packaging_item_id] = (needs[rule.packaging_item_id] || 0) + matchQty * Number(rule.qty_per_unit);
      }
    }
  });
  return needs;
}

/** يطبّق فرق احتياج التغليف بين بنود الطلب القديمة والجديدة على المخزون (استهلاك أو إرجاع)
 *  @returns {string[]} تحذيرات (لو صار مخزون سالب لأي صنف) */
async function applyPackagingDelta(orderId, newItems, oldItems){
  const newNeeds = computePackagingNeeds(newItems);
  const oldNeeds = computePackagingNeeds(oldItems || []);
  const allIds = new Set([...Object.keys(newNeeds), ...Object.keys(oldNeeds)].map(Number));
  const warnings = [];
  for (const packagingItemId of allIds){
    const delta = (newNeeds[packagingItemId] || 0) - (oldNeeds[packagingItemId] || 0);
    if (!delta) continue;
    const { data, error } = await sb.rpc('fn_adjust_packaging_stock', {
      p_item_id: packagingItemId, p_delta: -delta, p_order_id: orderId
    });
    if (error){
      warnings.push('تعذّر تحديث "' + (nameOfPackagingItem(packagingItemId)) + '": ' + error.message);
    } else if (data && data.is_negative){
      warnings.push('"' + nameOfPackagingItem(packagingItemId) + '" وصل مخزون سالب — راجعه.');
    }
  }
  return warnings;
}
function nameOfPackagingItem(id){
  const w = (state.warehouse||[]).find(x => x.id === id);
  return w ? w.name : ('صنف #' + id);
}

/* ========================= إدارة القواعد (صفحة المستودع) ========================= */
function togglePackagingRuleProductField(){
  document.getElementById('pkgRuleProductWrap').style.display =
    document.getElementById('pkgRuleType').value === 'per_product' ? 'block' : 'none';
}
/** يعبّي قوائم الاختيار بفورم إضافة قاعدة تغليف: صنف التغليف + المنتج المرتبط */
function populatePackagingRuleSelects(){
  const itemEl = document.getElementById('pkgRuleItem');
  const productEl = document.getElementById('pkgRuleProduct');
  if (!itemEl || !productEl) return;
  itemEl.innerHTML = ['<option value="">اختر صنف تغليف...</option>'].concat(
    (state.warehouse||[]).filter(w => w.itemType === 'packaging').map(w =>
      `<option value="${w.id}">${escapeHtml(w.name)} (المخزون الحالي: ${w.stock})</option>`)
  ).join('');
  productEl.innerHTML = ['<option value="">اختر منتج/خدمة...</option>'].concat(
    (state.warehouse||[]).filter(w => w.itemType !== 'packaging').map(w =>
      `<option value="${escapeHtml(w.name)}">${escapeHtml(w.name)}</option>`)
  ).join('');
}
async function savePackagingRule(){
  const ruleType = document.getElementById('pkgRuleType').value;
  const packagingItemId = Number(document.getElementById('pkgRuleItem').value) || null;
  const linkedProduct = ruleType === 'per_product' ? document.getElementById('pkgRuleProduct').value : null;
  const qtyPerUnit = Number(document.getElementById('pkgRuleQty').value) || 0;
  if (!packagingItemId){ showToast('اختر صنف التغليف.', true); return; }
  if (ruleType === 'per_product' && !linkedProduct){ showToast('اختر المنتج المرتبط بهذي القاعدة.', true); return; }
  if (!qtyPerUnit){ showToast('أدخل الكمية لكل وحدة.', true); return; }
  showLoading(true);
  const { error } = await sb.from('packaging_rules').insert({
    rule_type: ruleType, packaging_item_id: packagingItemId,
    linked_product_name: linkedProduct, qty_per_unit: qtyPerUnit
  });
  showLoading(false);
  if (error){ showToast('تعذّر حفظ القاعدة: ' + error.message, true); return; }
  showToast('✅ تم حفظ القاعدة.');
  document.getElementById('pkgRuleItem').value = '';
  document.getElementById('pkgRuleProduct').value = '';
  document.getElementById('pkgRuleQty').value = '';
  await loadPackagingRules();
}
async function deletePackagingRule(id){
  if (!confirm('تأكيد حذف هذي القاعدة؟ (ما يمس أي استهلاك سابق، بس توقف الاستهلاك التلقائي المستقبلي)')) return;
  showLoading(true);
  const { error } = await sb.from('packaging_rules').delete().eq('id', id);
  showLoading(false);
  if (error){ showToast('تعذّر الحذف: ' + error.message, true); return; }
  showToast('تم الحذف.');
  await loadPackagingRules();
}
function renderPackagingRulesList(){
  const el = document.getElementById('packagingRulesList');
  if (!el) return;
  if (!state.packagingRules.length){ el.innerHTML = '<div class="hint">ما فيه قواعد مسجّلة بعد.</div>'; return; }
  el.innerHTML = state.packagingRules.map(r => `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px dashed var(--line);padding:6px 0;font-size:12.5px;">
      <div>
        <b>${escapeHtml(nameOfPackagingItem(r.packaging_item_id))}</b>
        — ${r.rule_type === 'per_order' ? 'مع كل طلب' : ('مع منتج: ' + escapeHtml(r.linked_product_name))}
        (× ${r.qty_per_unit})
      </div>
      <button class="btn-sm btn-ghost" style="color:var(--debt);" onclick="deletePackagingRule(${r.id})">🗑️</button>
    </div>`).join('');
}
