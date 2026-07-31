/* ============================================================
   خدمة المخزون — تراث العز
   عملية التحويل/التمييع: مصدر واحد → ناتج واحد أو أكثر بنفس العملية
   (مثال: ذبيحة ← لحم + جلد)، مع فاقد اختياري ودعم الأحجام المستقلة.
   سيتوسّع لاحقاً بمنطق المخازن المتعددة.
   ============================================================ */

/**
 * ينفّذ عملية تحويل/تمييع: يستهلك كمية من صنف مصدر، يضيف كميات لناتج واحد
 * أو أكثر، بمعاملة آمنة واحدة (fn_convert_stock).
 * @param {Object} p
 * @param {number} p.sourceItemId
 * @param {number|null} p.sourceVariantId
 * @param {number} p.sourceQtyConsumed
 * @param {Array<{itemId:number, variantId:(number|null), qty:number}>} p.outputs
 * @param {boolean} p.computeWaste
 * @param {string} p.note
 */
async function convertStock({ sourceItemId, sourceVariantId, sourceQtyConsumed, outputs, computeWaste, note, executorWorkerId, batchCount }) {
  const payloadOutputs = (outputs || []).map(o => ({
    item_id: o.itemId, variant_id: o.variantId || null, qty: o.qty
  }));
  const { data, error } = await sb.rpc('fn_convert_stock', {
    p_source_item_id: sourceItemId,
    p_source_variant_id: sourceVariantId || null,
    p_source_qty_consumed: sourceQtyConsumed,
    p_outputs: payloadOutputs,
    p_compute_waste: !!computeWaste,
    p_note: note || null,
    p_executor_worker_id: executorWorkerId || null
  });
  if (error) throw error;
  // عدد التمييعات حقل يدوي بسيط للمراجعة بس — يُحفظ بنداء تحديث منفصل خفيف بعد نجاح العملية
  if (batchCount && data && data.conversion_id){
    await sb.from('stock_conversions').update({ batch_count: batchCount }).eq('id', data.conversion_id);
  }
  return data;
}

/** يجيب آخر ٢٠ عملية تحويل + كل نواتجها الفرعية — لعرضها بسجل صفحة المستودع (بدون joins) */
async function loadRecentStockConversions() {
  const { data: conversions, error } = await sb
    .from('stock_conversions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  const ids = (conversions || []).map(c => c.id);
  let outputsByConversion = {};
  if (ids.length) {
    const { data: outputs, error: e2 } = await sb
      .from('stock_conversion_outputs')
      .select('*')
      .in('conversion_id', ids);
    if (e2) throw e2;
    (outputs || []).forEach(o => {
      (outputsByConversion[o.conversion_id] = outputsByConversion[o.conversion_id] || []).push(o);
    });
  }
  return (conversions || []).map(c => ({
    ...c,
    outputs: outputsByConversion[c.id] || []
  }));
}

/* ========================= واجهة التحويل/التمييع (صفحة المستودع) ========================= */
let convOutputsDraft = []; // [{itemId, variantId, qty}]

/** يعبّي قائمة "المصدر" بكل أصناف المستودع الحالية غير المركّبة، ويرسم صف ناتج فاضي أول مرة */
function populateConversionSelects(){
  const srcEl = document.getElementById('convSourceItem');
  if (!srcEl) return;
  srcEl.innerHTML = buildConvItemOptions();
  toggleConvVariantField('source');
  renderConvOutputRows();
}
/** يبني قائمة خيارات الأصناف (تُستخدم لصنف المصدر وكل صف ناتج) */
function buildConvItemOptions(){
  return ['<option value="">اختر صنف...</option>'].concat(
    (state.warehouse||[]).filter(w => !w.isComposite).map(w =>
      `<option value="${w.id}">${escapeHtml(w.name)} (المخزون الحالي: ${w.stock})</option>`)
  ).join('');
}
/** يظهر/يخفي قائمة اختيار "أي حجم بالضبط" لصنف المصدر — بس لو له أحجام مستقلة المخزون */
function toggleConvVariantField(which){
  if (which !== 'source') return; // النواتج تُدار بدوال الصفوف بالأسفل
  const itemSelect = document.getElementById('convSourceItem');
  const variantWrap = document.getElementById('convSourceVariantWrap');
  const variantSelect = document.getElementById('convSourceVariant');
  const itemId = Number(itemSelect.value) || null;
  const item = (state.warehouse||[]).find(w => w.id === itemId);
  const hasIndependentVariants = item && item.hasVariants && item.variantMode === 'independent_stock';
  if (!hasIndependentVariants){
    variantWrap.style.display = 'none';
    variantSelect.innerHTML = '';
    const hint = document.getElementById('convSourceKgHint');
    if (hint) hint.textContent = '';
    return;
  }
  const variants = state.itemVariants[itemId] || [];
  variantSelect.innerHTML = '<option value="">— المنتج الأساسي (بدون تحديد حجم) —</option>' +
    variants.map(v => `<option value="${v.id}">${escapeHtml(v.variant_name)} (المخزون الحالي: ${v.stock})</option>`).join('');
  variantWrap.style.display = 'block';
  updateConvSourceKgHint();
}
/** يعرض "= X كيلو" تلقائياً لو الحجم المختار للمصدر له وزن وحدة مسجّل */
function updateConvSourceKgHint(){
  const hint = document.getElementById('convSourceKgHint');
  if (!hint) return;
  const itemId = Number(document.getElementById('convSourceItem').value) || null;
  const variantId = Number(document.getElementById('convSourceVariant').value) || null;
  const qty = Number(document.getElementById('convSourceQty').value) || 0;
  if (!variantId || !qty){ hint.textContent = ''; return; }
  const variant = (state.itemVariants[itemId] || []).find(v => v.id === variantId);
  if (!variant || !variant.weight_kg){ hint.textContent = ''; return; }
  hint.textContent = '= ' + (qty * Number(variant.weight_kg)).toLocaleString() + ' كيلو فعلي (حسب وزن الوحدة المسجّل لهذا الحجم)';
}

/** يضيف صف ناتج جديد فاضي */
function addConvOutputRow(){
  convOutputsDraft.push({ itemId: null, variantId: null, qty: '' });
  renderConvOutputRows();
}
function removeConvOutputRow(idx){
  convOutputsDraft.splice(idx, 1);
  renderConvOutputRows();
}
function updateConvOutputRow(idx, field, value){
  if (field === 'itemId'){
    convOutputsDraft[idx].itemId = Number(value) || null;
    convOutputsDraft[idx].variantId = null; // الصنف تغيّر، نصفّر اختيار الحجم
  } else if (field === 'variantId'){
    convOutputsDraft[idx].variantId = Number(value) || null;
  } else if (field === 'qty'){
    convOutputsDraft[idx].qty = Number(value) || 0;
  }
  renderConvOutputRows();
}
/** يرسم كل صفوف النواتج — كل صف: صنف + (حجم لو له أحجام مستقلة) + كمية + زر حذف */
function renderConvOutputRows(){
  const el = document.getElementById('convOutputsRows');
  if (!el) return;
  if (!convOutputsDraft.length){
    el.innerHTML = '<div class="hint">ما فيه نواتج بعد — اضغط "+ أضف ناتج".</div>';
    return;
  }
  const itemOptions = buildConvItemOptions();
  el.innerHTML = convOutputsDraft.map((row, idx) => {
    const item = (state.warehouse||[]).find(w => w.id === row.itemId);
    const hasIndependentVariants = item && item.hasVariants && item.variantMode === 'independent_stock';
    const variants = hasIndependentVariants ? (state.itemVariants[row.itemId] || []) : [];
    const selectedVariant = row.variantId ? variants.find(v => v.id === row.variantId) : null;
    const kgHint = (selectedVariant && selectedVariant.weight_kg && row.qty)
      ? ('= ' + (Number(row.qty) * Number(selectedVariant.weight_kg)).toLocaleString() + ' كيلو فعلي')
      : '';
    return `
      <div style="border:1px dashed var(--line);border-radius:8px;padding:10px;margin-bottom:8px;">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <select style="flex:2;min-width:160px;" onchange="updateConvOutputRow(${idx},'itemId',this.value)">
            ${itemOptions.replace(`value="${row.itemId}"`, `value="${row.itemId}" selected`)}
          </select>
          <input type="number" min="0" step="0.01" placeholder="الكمية" value="${row.qty||''}" style="flex:0 0 100px;" onchange="updateConvOutputRow(${idx},'qty',this.value)">
          <button type="button" class="btn-sm btn-ghost" onclick="removeConvOutputRow(${idx})">✕</button>
        </div>
        ${hasIndependentVariants ? `
        <div style="margin-top:6px;">
          <select onchange="updateConvOutputRow(${idx},'variantId',this.value)">
            <option value="">— المنتج الأساسي (بدون تحديد حجم) —</option>
            ${variants.map(v => `<option value="${v.id}" ${v.id===row.variantId?'selected':''}>${escapeHtml(v.variant_name)} (المخزون الحالي: ${v.stock})</option>`).join('')}
          </select>
        </div>` : ''}
        ${kgHint ? `<div class="hint" style="margin-top:4px;">${kgHint} (حسب وزن الوحدة المسجّل لهذا الحجم)</div>` : ''}
      </div>`;
  }).join('');
}

/** ينفّذ عملية التحويل من الفورم، ويحدّث المستودع والسجل بعد النجاح */
async function submitStockConversion(){
  const sourceItemId = Number(document.getElementById('convSourceItem').value) || null;
  const sourceVariantId = Number(document.getElementById('convSourceVariant').value) || null;
  const sourceQtyConsumed = Number(document.getElementById('convSourceQty').value) || 0;
  const computeWaste = document.getElementById('convComputeWaste').checked;
  const note = document.getElementById('convNote').value.trim();
  const executorWorkerId = Number(document.getElementById('convExecutorWorker').value) || null;
  const batchCount = document.getElementById('convBatchCount').value !== '' ? Number(document.getElementById('convBatchCount').value) : null;

  if (!sourceItemId){ showToast('اختر صنف المصدر.', true); return; }
  if (!sourceQtyConsumed){ showToast('أدخل الكمية المستهلكة من المصدر.', true); return; }
  const validOutputs = convOutputsDraft.filter(o => o.itemId && o.qty > 0);
  if (!validOutputs.length){ showToast('أضف ناتج واحد على الأقل بكمية أكبر من صفر.', true); return; }
  const badOutput = validOutputs.find(o => o.itemId === sourceItemId && o.variantId === sourceVariantId);
  if (badOutput){ showToast('لازم يكون كل ناتج مختلف عن المصدر (صنف أو حجم مختلف على الأقل).', true); return; }

  showLoading(true);
  try {
    const result = await convertStock({
      sourceItemId, sourceVariantId, sourceQtyConsumed,
      outputs: validOutputs, computeWaste, note, executorWorkerId, batchCount
    });
    const wasteNote = result.waste_qty !== null && result.waste_qty !== undefined
      ? (' — الفاقد المحسوب: ' + Number(result.waste_qty).toLocaleString())
      : '';
    showToast('✅ تم تنفيذ التحويل بنجاح (' + result.outputs_count + ' ناتج).' + wasteNote);
    document.getElementById('convSourceQty').value = '';
    document.getElementById('convNote').value = '';
    document.getElementById('convComputeWaste').checked = false;
    document.getElementById('convBatchCount').value = '';
    document.getElementById('convExecutorWorker').value = '';
    convOutputsDraft = [];
    await loadWarehouse();
    populateConversionSelects();
    if (document.getElementById('accStockConvertLog').classList.contains('open')) loadStockConversionsIntoLog();
  } catch(e){
    showToast('تعذّر تنفيذ التحويل: ' + e.message, true);
  } finally {
    showLoading(false);
  }
}

/** يعرض سجل آخر عمليات التحويل — يشمل كل نواتج كل عملية، الأحجام، واسم الموظف */
async function loadStockConversionsIntoLog(){
  const box = document.getElementById('stockConversionsLog');
  box.innerHTML = '<div class="hint">جارِ التحميل…</div>';
  try {
    const rows = await loadRecentStockConversions();
    if (!rows.length){ box.innerHTML = '<div class="hint">ما فيه عمليات تحويل مسجّلة بعد.</div>'; return; }
    const nameOf = id => { const w = (state.warehouse||[]).find(x => x.id === id); return w ? w.name : ('صنف #' + id); };
    const variantNameOf = (itemId, variantId) => {
      if (!variantId) return '';
      const v = (state.itemVariants[itemId] || []).find(x => x.id === variantId);
      return v ? (' — حجم: ' + v.variant_name) : '';
    };
    box.innerHTML = rows.map(r => {
      // توافق مع سجلات قديمة (ناتج واحد كان مباشرة بنفس الصف قبل هذا التحديث)
      const outputs = r.outputs.length ? r.outputs : (r.output_item_id ? [{
        output_item_id: r.output_item_id, output_variant_id: r.output_variant_id, output_qty_produced: r.output_qty_produced
      }] : []);
      const outputsHtml = outputs.map(o =>
        `<div>➡️ <b>${escapeHtml(nameOf(o.output_item_id))}${escapeHtml(variantNameOf(o.output_item_id, o.output_variant_id))}</b> (+${o.output_qty_produced})</div>`
      ).join('');
      return `
      <div style="border-bottom:1px dashed var(--line);padding:8px 0;font-size:12.5px;">
        <div><b>${escapeHtml(nameOf(r.source_item_id))}${escapeHtml(variantNameOf(r.source_item_id, r.source_variant_id))}</b> (−${r.source_qty_consumed})</div>
        ${outputsHtml}
        ${r.waste_qty !== null && r.waste_qty !== undefined ? `<div style="color:var(--debt);">فاقد: ${r.waste_qty}</div>` : ''}
        ${r.batch_count !== null && r.batch_count !== undefined ? `<div>عدد التمييعات: ${r.batch_count}</div>` : ''}
        ${r.executor_worker_id ? `<div>👷 المنفّذ: ${escapeHtml(((state.workers||[]).find(w => w.id === r.executor_worker_id) || {}).name || 'شخص محذوف/موقوف')}</div>` : ''}
        ${r.note ? ('<div class="hint" style="margin-top:2px;">' + escapeHtml(r.note) + '</div>') : ''}
        <div class="hint" style="margin-top:2px;">👤 ${escapeHtml(r.created_by_name || 'غير معروف')} — ${new Date(r.created_at).toLocaleString('ar-SA')}</div>
      </div>`;
    }).join('');
  } catch(e){
    box.innerHTML = '<div class="hint" style="color:var(--debt);">تعذّر تحميل السجل: ' + e.message + '</div>';
  }
}

/* ========================= المخازن/الفروع (أساس — مخزن افتراضي واحد حالياً) ========================= */
/** يحمّل قائمة المخازن النشطة */
async function loadWarehousesList(){
  const { data, error } = await sb.from('warehouses').select('*').eq('is_active', true).order('id');
  if (error){ showToast('تعذّر تحميل المخازن: ' + error.message, true); return; }
  state.warehousesList = data || [];
  renderWarehousesList();
}
async function addWarehouseBranch(){
  const name = document.getElementById('whNewWarehouseName').value.trim();
  const notes = document.getElementById('whNewWarehouseNotes').value.trim() || null;
  if (!name){ showToast('اسم المخزن مطلوب.', true); return; }
  showLoading(true);
  const { error } = await sb.from('warehouses').insert({ name, notes });
  showLoading(false);
  if (error){ showToast('تعذّر الإضافة: ' + error.message, true); return; }
  showToast('✅ تمت الإضافة. ملاحظة: باقي أجزاء النظام لسه ما تدعم الفصل الفعلي بين المخازن — يحتاج جلسة توسعة مخصصة لاحقاً.');
  document.getElementById('whNewWarehouseName').value = '';
  document.getElementById('whNewWarehouseNotes').value = '';
  await loadWarehousesList();
}
function renderWarehousesList(){
  const el = document.getElementById('warehousesList');
  if (!el) return;
  el.innerHTML = (state.warehousesList||[]).map(w => `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px dashed var(--line);padding:6px 0;font-size:13px;">
      <div><b>${escapeHtml(w.name)}</b>${w.is_default ? ' <span class="badge" style="background:#eef1e0;color:var(--teal);">افتراضي</span>' : ''}${w.notes ? (' — ' + escapeHtml(w.notes)) : ''}</div>
    </div>`).join('') || '<div class="hint">ما فيه مخازن مسجّلة.</div>';
}
