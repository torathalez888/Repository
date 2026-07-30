/* ============================================================
   خدمة المخزون — تراث العز
   يبدأ بعملية التحويل/التمييع (مادة خام → منتج، مع فاقد اختياري).
   سيتوسّع لاحقاً بمنطق المخازن المتعددة.
   ============================================================ */

/**
 * ينفّذ عملية تحويل/تمييع: يستهلك كمية من صنف مصدر، يضيف كمية لصنف ناتج،
 * بمعاملة آمنة واحدة (fn_convert_stock) — تُسجَّل بسجل حركات المخزون تلقائياً.
 * @param {Object} p
 * @param {number} p.sourceItemId
 * @param {number} p.sourceQtyConsumed
 * @param {number} p.outputItemId
 * @param {number} p.outputQtyProduced
 * @param {boolean} p.computeWaste - يُفعّل بس لو المصدر والناتج بنفس وحدة القياس
 * @param {string} p.note
 */
async function convertStock({ sourceItemId, sourceQtyConsumed, outputItemId, outputQtyProduced, computeWaste, note }) {
  const { data, error } = await sb.rpc('fn_convert_stock', {
    p_source_item_id: sourceItemId,
    p_source_qty_consumed: sourceQtyConsumed,
    p_output_item_id: outputItemId,
    p_output_qty_produced: outputQtyProduced,
    p_compute_waste: !!computeWaste,
    p_note: note || null
  });
  if (error) throw error;
  return data;
}

/** يجيب آخر ٢٠ عملية تحويل مسجّلة — لعرضها بسجل صفحة المستودع (بدون joins، الأسماء تُحل من state.warehouse بالواجهة) */
async function loadRecentStockConversions() {
  const { data, error } = await sb
    .from('stock_conversions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data || [];
}

/* ========================= واجهة التحويل/التمييع (صفحة المستودع) ========================= */
/** يعبّي قائمتي "المصدر" و"الناتج" بكل أصناف المستودع الحالية غير المركّبة */
function populateConversionSelects(){
  const srcEl = document.getElementById('convSourceItem');
  const outEl = document.getElementById('convOutputItem');
  if (!srcEl || !outEl) return;
  const options = ['<option value="">اختر صنف...</option>'].concat(
    (state.warehouse||[]).filter(w => !w.isComposite).map(w =>
      `<option value="${w.id}">${escapeHtml(w.name)} (المخزون الحالي: ${w.stock})</option>`)
  ).join('');
  srcEl.innerHTML = options;
  outEl.innerHTML = options;
}
/** ينفّذ عملية التحويل من الفورم، ويحدّث المستودع والسجل بعد النجاح */
async function submitStockConversion(){
  const sourceItemId = Number(document.getElementById('convSourceItem').value) || null;
  const sourceQtyConsumed = Number(document.getElementById('convSourceQty').value) || 0;
  const outputItemId = Number(document.getElementById('convOutputItem').value) || null;
  const outputQtyProduced = Number(document.getElementById('convOutputQty').value) || 0;
  const computeWaste = document.getElementById('convComputeWaste').checked;
  const note = document.getElementById('convNote').value.trim();
  if (!sourceItemId || !outputItemId){ showToast('اختر صنف المصدر وصنف الناتج.', true); return; }
  if (sourceItemId === outputItemId){ showToast('لازم يكون المصدر والناتج صنفين مختلفين.', true); return; }
  if (!sourceQtyConsumed){ showToast('أدخل الكمية المستهلكة من المصدر.', true); return; }
  showLoading(true);
  try {
    const result = await convertStock({ sourceItemId, sourceQtyConsumed, outputItemId, outputQtyProduced, computeWaste, note });
    const wasteNote = result.waste_qty !== null && result.waste_qty !== undefined
      ? (' — الفاقد المحسوب: ' + Number(result.waste_qty).toLocaleString())
      : '';
    showToast('✅ تم تنفيذ التحويل بنجاح.' + wasteNote);
    document.getElementById('convSourceQty').value = '';
    document.getElementById('convOutputQty').value = '';
    document.getElementById('convNote').value = '';
    document.getElementById('convComputeWaste').checked = false;
    await loadWarehouse();
    populateConversionSelects();
    if (document.getElementById('accStockConvertLog').classList.contains('open')) loadStockConversionsIntoLog();
  } catch(e){
    showToast('تعذّر تنفيذ التحويل: ' + e.message, true);
  } finally {
    showLoading(false);
  }
}
/** يعرض سجل آخر عمليات التحويل، مع حل أسماء الأصناف من state.warehouse */
async function loadStockConversionsIntoLog(){
  const box = document.getElementById('stockConversionsLog');
  box.innerHTML = '<div class="hint">جارِ التحميل…</div>';
  try {
    const rows = await loadRecentStockConversions();
    if (!rows.length){ box.innerHTML = '<div class="hint">ما فيه عمليات تحويل مسجّلة بعد.</div>'; return; }
    const nameOf = id => { const w = (state.warehouse||[]).find(x => x.id === id); return w ? w.name : ('صنف #' + id); };
    box.innerHTML = rows.map(r => `
      <div style="border-bottom:1px dashed var(--line);padding:8px 0;font-size:12.5px;">
        <b>${escapeHtml(nameOf(r.source_item_id))}</b> (−${r.source_qty_consumed})
        ← <b>${escapeHtml(nameOf(r.output_item_id))}</b> (+${r.output_qty_produced})
        ${r.waste_qty !== null && r.waste_qty !== undefined ? ` <span style="color:var(--debt);">فاقد: ${r.waste_qty}</span>` : ''}
        ${r.note ? ('<div class="hint" style="margin-top:2px;">' + escapeHtml(r.note) + '</div>') : ''}
        <div class="hint" style="margin-top:2px;">${new Date(r.created_at).toLocaleString('ar-SA')}</div>
      </div>`).join('');
  } catch(e){
    box.innerHTML = '<div class="hint" style="color:var(--debt);">تعذّر تحميل السجل: ' + e.message + '</div>';
  }
}
