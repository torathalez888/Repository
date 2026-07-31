/* ============================================================
   خدمة العملاء — تراث العز
   يبدأ بدالة إضافة رقم/عنوان ثانوي، وسيتوسّع لاحقاً وقت إعادة
   بناء صفحة العملاء الكاملة (نوع العميل، التسعير، VIP...).
   ============================================================ */

/**
 * يدمج عميل مكرر بعميل أساسي — كل الطلبات/الديون/الرصيد الدائن تنتقل
 * تلقائياً للأساسي بمعاملة آمنة واحدة (fn_merge_customers)، ثم يُحذف المكرر.
 * @param {number} primaryId - السجل اللي بيبقى
 * @param {number} duplicateId - السجل اللي بينحذف بعد نقل بياناته
 */
async function mergeCustomers(primaryId, duplicateId) {
  const { data, error } = await sb.rpc('fn_merge_customers', {
    p_primary_id: primaryId,
    p_duplicate_id: duplicateId
  });
  if (error) throw error;
  return data;
}

/* ========================= رصيد العميل الدائن — العرض والتاريخ والإرجاع ========================= */
/** يعرض رصيد العميل الحالي + تاريخ الحركات (من أي طلب جا كل جزء) + زر إرجاع */
async function loadCustomerCreditPanel(phone){
  const box = document.getElementById('custCreditPanel');
  if (!box) return;
  const normalizedPhone = normalizePhoneClient(phone) || phone;
  if (!normalizedPhone){ box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.innerHTML = '<div class="hint">جارِ تحميل الرصيد…</div>';
  try {
    const [{ data: balanceRow }, { data: history, error: histErr }] = await Promise.all([
      sb.from('credit_balances').select('balance').eq('customer_phone', normalizedPhone).maybeSingle(),
      sb.from('credit_balance_history').select('*').eq('customer_phone', normalizedPhone).order('created_at', { ascending: false }).limit(20)
    ]);
    if (histErr) throw histErr;
    const balance = Number((balanceRow && balanceRow.balance) || 0);
    const historyHtml = (history && history.length) ? history.map(h => `
      <div style="display:flex;justify-content:space-between;border-bottom:1px dashed var(--line);padding:5px 0;font-size:12px;">
        <div>
          <span style="color:${h.amount>0?'var(--teal)':'var(--debt)'};font-weight:700;">${h.amount>0?'+':''}${Number(h.amount).toLocaleString()} ر.س</span>
          — ${escapeHtml(h.reason)}${h.order_id ? (' (طلب #' + h.order_id + ')') : ''}
        </div>
        <div class="hint">${new Date(h.created_at).toLocaleDateString('ar-SA')}</div>
      </div>`).join('') : '<div class="hint">ما فيه حركات رصيد مسجّلة بعد.</div>';
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <b>💰 الرصيد الدائن الحالي: <span style="color:var(--brass-dark);">${balance.toLocaleString()} ر.س</span></b>
        ${balance > 0.009 ? `<button class="btn-sm btn-teal" onclick="openRefundCreditModal('${normalizedPhone.replace(/'/g,"")}', ${balance})">↩️ إرجاع للعميل</button>` : ''}
      </div>
      <div style="max-height:180px;overflow-y:auto;">${historyHtml}</div>
    `;
  } catch(e){
    box.innerHTML = '<div class="hint" style="color:var(--debt);">تعذّر تحميل الرصيد: ' + e.message + '</div>';
  }
}
/** يفتح نافذة صغيرة لإرجاع مبلغ من الرصيد الدائن للعميل نقداً */
function openRefundCreditModal(phone, currentBalance){
  const body = `
    <div class="hint" style="margin-top:-4px;">الرصيد الحالي: ${currentBalance.toLocaleString()} ر.س</div>
    <label>المبلغ المرجَّع للعميل</label>
    <input id="refundAmount" type="number" min="0.01" step="0.01" max="${currentBalance}" placeholder="مثال: 50">
    <label>ملاحظة (اختياري)</label>
    <input id="refundNote" placeholder="اختياري">
    <button class="write-action btn-primary" style="width:100%;margin-top:10px;" onclick="submitRefundCredit('${phone.replace(/'/g,"")}')">↩️ تأكيد الإرجاع</button>
  `;
  openGenericModal('↩️ إرجاع رصيد للعميل', body);
}
async function submitRefundCredit(phone){
  const amount = Number(document.getElementById('refundAmount').value) || 0;
  const note = document.getElementById('refundNote').value.trim();
  if (!amount){ showToast('أدخل المبلغ أول.', true); return; }
  if (!confirm('تأكيد إرجاع ' + amount.toLocaleString() + ' ر.س نقداً للعميل؟ (سينقص من رصيده الدائن)')) return;
  showLoading(true);
  try {
    const { error } = await sb.rpc('fn_refund_customer_credit', { p_customer_phone: phone, p_amount: amount, p_note: note || null });
    if (error) throw error;
    showToast('✅ تم إرجاع المبلغ بنجاح.');
    closeGenericModal();
    await loadCustomerCreditPanel(phone);
  } catch(e){
    showToast('تعذّر الإرجاع: ' + e.message, true);
  } finally {
    showLoading(false);
  }
}
/**
 * يضيف رقم جوال ثانوي مرتبط بعميل موجود (اختياري — لا يمس الرقم الأساسي).
 * @param {number} customerId
 * @param {string} phone
 */
async function addSecondaryPhone(customerId, phone) {
  if (!customerId || !phone || !phone.trim()) return;
  const { error } = await sb.from('customer_phones').insert({
    customer_id: customerId,
    phone: phone.trim()
  });
  if (error) throw error;
}

/**
 * يضيف عنوان ثانوي مرتبط بعميل موجود (اختياري — لا يمس العنوان الأساسي).
 * @param {number} customerId
 * @param {string} address
 */
async function addSecondaryAddress(customerId, address) {
  if (!customerId || !address || !address.trim()) return;
  const { error } = await sb.from('customer_addresses').insert({
    customer_id: customerId,
    address: address.trim()
  });
  if (error) throw error;
}
