/* ============================================================
   خدمة التغليف — تراث العز
   قواعد استهلاك مستلزمات التغليف المرتبط بالطلبات (عامة/لمنتج معيّن،
   بدعم اختيار حجم بالذات)، وربط اختياري بين منتج/حجم وعبوة تغليف
   تُستهلك تلقائياً وقت التحويل. الاثنان يعملان عبر نداء تابع آمن،
   بدون تعديل fn_save_order.
   ============================================================ */

/** يحمّل كل قواعد التغليف المفعّلة */
async function loadPackagingRules(){
  const { data, error } = await sb.from('packaging_rules').select('*').eq('is_active', true);
  if (error){ showToast('تعذّر تحميل قواعد التغليف: ' + error.message, true); return; }
  state.packagingRules = data || [];
  renderPackagingRulesList();
}

/** يحسب احتياج كل صنف/حجم تغليف لمجموعة بنود طلب معيّنة، حسب القواعد المفعّلة حالياً
 *  @returns {Object} مفتاح "itemId:variantId" -> qty */
function computePackagingNeeds(items){
  const needs = {};
  if (!items || !items.length) return needs;
  (state.packagingRules || []).forEach(rule => {
    const key = rule.packaging_item_id + ':' + (rule.packaging_variant_id || '');
    if (rule.rule_type === 'per_order'){
      needs[key] = (needs[key] || 0) + Number(rule.qty_per_unit);
    } else if (rule.rule_type === 'per_product'){
      const matchQty = items
        .filter(it => (it.name || it.product) === rule.linked_product_name)
        .reduce((s, it) => s + Number(it.qty || 0), 0);
      if (matchQty > 0){
        needs[key] = (needs[key] || 0) + matchQty * Number(rule.qty_per_unit);
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
  const allKeys = new Set([...Object.keys(newNeeds), ...Object.keys(oldNeeds)]);
  const warnings = [];
  for (const key of allKeys){
    const delta = (newNeeds[key] || 0) - (oldNeeds[key] || 0);
    if (!delta) continue;
    const [itemIdStr, variantIdStr] = key.split(':');
    const itemId = Number(itemIdStr);
    const variantId = variantIdStr ? Number(variantIdStr) : null;
    const { data, error } = await sb.rpc('fn_adjust_packaging_stock', {
      p_item_id: itemId, p_delta: -delta, p_order_id: orderId, p_variant_id: variantId
    });
    if (error){
      warnings.push('تعذّر تحديث "' + (nameOfPackagingItem(itemId)) + '": ' + error.message);
    } else if (data && data.is_negative){
      warnings.push('"' + nameOfPackagingItem(itemId) + '" وصل مخزون سالب — راجعه.');
    }
  }
  return warnings;
}
function nameOfPackagingItem(id){
  const w = (state.warehouse||[]).find(x => x.id === id);
  return w ? w.name : ('صنف #' + id);
}

/* ========================= إدارة قواعد التغليف (صفحة المستودع) ========================= */
function togglePackagingRuleProductField(){
  document.getElementById('pkgRuleProductWrap').style.display =
    document.getElementById('pkgRuleType').value === 'per_product' ? 'block' : 'none';
}
/** يظهر/يخفي اختيار "أي حجم بالذات" لصنف التغليف بالقاعدة — بس لو له أحجام مستقلة المخزون */
function togglePkgRuleVariantField(){
  const itemId = Number(document.getElementById('pkgRuleItem').value) || null;
  const item = (state.warehouse||[]).find(w => w.id === itemId);
  const wrap = document.getElementById('pkgRuleVariantWrap');
  const sel = document.getElementById('pkgRuleVariant');
  const hasIndependentVariants = item && item.hasVariants && item.variantMode === 'independent_stock';
  if (!hasIndependentVariants){ wrap.style.display = 'none'; sel.innerHTML = ''; return; }
  const variants = state.itemVariants[itemId] || [];
  sel.innerHTML = '<option value="">— الصنف الأساسي (بدون تحديد حجم) —</option>' +
    variants.map(v => `<option value="${v.id}">${escapeHtml(v.variant_name)} (المخزون الحالي: ${v.stock})</option>`).join('');
  wrap.style.display = 'block';
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
  togglePkgRuleVariantField();
}
async function savePackagingRule(){
  const ruleType = document.getElementById('pkgRuleType').value;
  const packagingItemId = Number(document.getElementById('pkgRuleItem').value) || null;
  const packagingVariantId = Number(document.getElementById('pkgRuleVariant').value) || null;
  const linkedProduct = ruleType === 'per_product' ? document.getElementById('pkgRuleProduct').value : null;
  const qtyPerUnit = Number(document.getElementById('pkgRuleQty').value) || 0;
  if (!packagingItemId){ showToast('اختر صنف التغليف.', true); return; }
  if (ruleType === 'per_product' && !linkedProduct){ showToast('اختر المنتج المرتبط بهذي القاعدة.', true); return; }
  if (!qtyPerUnit){ showToast('أدخل الكمية لكل وحدة.', true); return; }
  showLoading(true);
  const { error } = await sb.from('packaging_rules').insert({
    rule_type: ruleType, packaging_item_id: packagingItemId, packaging_variant_id: packagingVariantId,
    linked_product_name: linkedProduct, qty_per_unit: qtyPerUnit
  });
  showLoading(false);
  if (error){ showToast('تعذّر حفظ القاعدة: ' + error.message, true); return; }
  showToast('✅ تم حفظ القاعدة.');
  document.getElementById('pkgRuleItem').value = '';
  document.getElementById('pkgRuleProduct').value = '';
  document.getElementById('pkgRuleQty').value = '';
  togglePkgRuleVariantField();
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
function variantNameOfPackagingItem(itemId, variantId){
  if (!variantId) return '';
  const v = (state.itemVariants[itemId] || []).find(x => x.id === variantId);
  return v ? (' — حجم: ' + v.variant_name) : '';
}
function renderPackagingRulesList(){
  const el = document.getElementById('packagingRulesList');
  if (!el) return;
  if (!state.packagingRules.length){ el.innerHTML = '<div class="hint">ما فيه قواعد مسجّلة بعد.</div>'; return; }
  el.innerHTML = state.packagingRules.map(r => `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px dashed var(--line);padding:6px 0;font-size:12.5px;">
      <div>
        <b>${escapeHtml(nameOfPackagingItem(r.packaging_item_id))}${escapeHtml(variantNameOfPackagingItem(r.packaging_item_id, r.packaging_variant_id))}</b>
        — ${r.rule_type === 'per_order' ? 'مع كل طلب' : ('مع منتج: ' + escapeHtml(r.linked_product_name))}
        (× ${r.qty_per_unit})
      </div>
      <button class="btn-sm btn-ghost" style="color:var(--debt);" onclick="deletePackagingRule(${r.id})">🗑️</button>
    </div>`).join('');
}

/* ========================= ربط منتج/حجم بعبوة تغليف (يُستهلك وقت التحويل) ========================= */
/** يحمّل كل الروابط الحالية */
async function loadOutputPackagingLinks(){
  const { data, error } = await sb.from('output_packaging_links').select('*').eq('is_active', true);
  if (error){ showToast('تعذّر تحميل روابط التغليف: ' + error.message, true); return; }
  state.outputPackagingLinks = data || [];
  renderPkgLinksList();
}
/** يعبّي قوائم اختيار المنتج وعبوة التغليف بفورم الربط */
function populatePkgLinkSelects(){
  const productEl = document.getElementById('pkgLinkProductItem');
  const packagingEl = document.getElementById('pkgLinkPackagingItem');
  if (!productEl || !packagingEl) return;
  productEl.innerHTML = ['<option value="">اختر منتج...</option>'].concat(
    (state.warehouse||[]).filter(w => w.itemType !== 'packaging' && !w.isComposite).map(w =>
      `<option value="${w.id}">${escapeHtml(w.name)}</option>`)
  ).join('');
  packagingEl.innerHTML = ['<option value="">اختر عبوة تغليف...</option>'].concat(
    (state.warehouse||[]).filter(w => w.itemType === 'packaging').map(w =>
      `<option value="${w.id}">${escapeHtml(w.name)} (المخزون الحالي: ${w.stock})</option>`)
  ).join('');
  togglePkgLinkVariantField('product');
  togglePkgLinkVariantField('packaging');
}
/** يظهر/يخفي اختيار "أي حجم بالذات" — لكل من المنتج والعبوة على حدة */
function togglePkgLinkVariantField(which){
  const itemEl = document.getElementById(which === 'product' ? 'pkgLinkProductItem' : 'pkgLinkPackagingItem');
  const wrap = document.getElementById(which === 'product' ? 'pkgLinkProductVariantWrap' : 'pkgLinkPackagingVariantWrap');
  const sel = document.getElementById(which === 'product' ? 'pkgLinkProductVariant' : 'pkgLinkPackagingVariant');
  const itemId = Number(itemEl.value) || null;
  const item = (state.warehouse||[]).find(w => w.id === itemId);
  const hasIndependentVariants = item && item.hasVariants && item.variantMode === 'independent_stock';
  if (!hasIndependentVariants){ wrap.style.display = 'none'; sel.innerHTML = ''; return; }
  const variants = state.itemVariants[itemId] || [];
  sel.innerHTML = '<option value="">— الصنف الأساسي (بدون تحديد حجم) —</option>' +
    variants.map(v => `<option value="${v.id}">${escapeHtml(v.variant_name)}</option>`).join('');
  wrap.style.display = 'block';
}
async function saveOutputPackagingLink(){
  const productItemId = Number(document.getElementById('pkgLinkProductItem').value) || null;
  const productVariantId = Number(document.getElementById('pkgLinkProductVariant').value) || null;
  const packagingItemId = Number(document.getElementById('pkgLinkPackagingItem').value) || null;
  const packagingVariantId = Number(document.getElementById('pkgLinkPackagingVariant').value) || null;
  const qtyPerUnit = Number(document.getElementById('pkgLinkQty').value) || 0;
  if (!productItemId){ showToast('اختر المنتج.', true); return; }
  if (!packagingItemId){ showToast('اختر عبوة التغليف.', true); return; }
  if (!qtyPerUnit){ showToast('أدخل عدد العبوات لكل وحدة.', true); return; }
  showLoading(true);
  const { error } = await sb.from('output_packaging_links').insert({
    product_item_id: productItemId, product_variant_id: productVariantId,
    packaging_item_id: packagingItemId, packaging_variant_id: packagingVariantId,
    qty_per_unit: qtyPerUnit
  });
  showLoading(false);
  if (error){ showToast('تعذّر حفظ الربط: ' + error.message, true); return; }
  showToast('✅ تم حفظ الربط.');
  document.getElementById('pkgLinkQty').value = '1';
  await loadOutputPackagingLinks();
}
async function deleteOutputPackagingLink(id){
  if (!confirm('تأكيد حذف هذا الربط؟ (يوقف الاستهلاك التلقائي المستقبلي بس)')) return;
  showLoading(true);
  const { error } = await sb.from('output_packaging_links').delete().eq('id', id);
  showLoading(false);
  if (error){ showToast('تعذّر الحذف: ' + error.message, true); return; }
  showToast('تم الحذف.');
  await loadOutputPackagingLinks();
}
function renderPkgLinksList(){
  const el = document.getElementById('pkgLinksList');
  if (!el) return;
  if (!state.outputPackagingLinks.length){ el.innerHTML = '<div class="hint">ما فيه روابط مسجّلة بعد.</div>'; return; }
  el.innerHTML = state.outputPackagingLinks.map(l => `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px dashed var(--line);padding:6px 0;font-size:12.5px;">
      <div>
        <b>${escapeHtml(nameOfPackagingItem(l.product_item_id))}${escapeHtml(variantNameOfPackagingItem(l.product_item_id, l.product_variant_id))}</b>
        ← <b>${escapeHtml(nameOfPackagingItem(l.packaging_item_id))}${escapeHtml(variantNameOfPackagingItem(l.packaging_item_id, l.packaging_variant_id))}</b>
        (× ${l.qty_per_unit})
      </div>
      <button class="btn-sm btn-ghost" style="color:var(--debt);" onclick="deleteOutputPackagingLink(${l.id})">🗑️</button>
    </div>`).join('');
}
