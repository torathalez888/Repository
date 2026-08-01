/* ============================================================
   خدمة الأشخاص المنفذين — تراث العز
   قائمة مستقلة عن users (موظفين النظام) لتتبّع عمالة غير مسجّلة
   بالنظام (مثل عامل ذبح)، وحساب مستحقاتهم آخر الشهر حسب طريقة
   الحساب المتفق عليها (بالتمييعة أو بالكيلوجرامات).
   ============================================================ */

/** يحمّل كل الأشخاص النشطين، ويعبّي قوائمهم بفورم التحويل وفورم حساب المستحق */
async function loadWorkers(){
  const { data, error } = await sb.from('workers').select('*').eq('is_active', true).order('name');
  if (error){ showToast('تعذّر تحميل قائمة الأشخاص: ' + error.message, true); return; }
  state.workers = data || [];
  populateExecutorWorkerSelect();
  populateWorkerPaySelect();
  renderWorkersManagementList();
}
/** يعبّي قائمة اختيار "الشخص المنفذ" بفورم التحويل (صفحة المستودع) */
function populateExecutorWorkerSelect(){
  const el = document.getElementById('convExecutorWorker');
  if (!el) return;
  el.innerHTML = '<option value="">— غير محدد —</option>' +
    state.workers.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
}
/** يعبّي قائمة اختيار الشخص بأداة "حساب المستحق" (صفحة المحاسبة) */
function populateWorkerPaySelect(){
  const el = document.getElementById('workerPaySelect');
  if (!el) return;
  el.innerHTML = '<option value="">اختر شخص...</option>' +
    state.workers.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
}
/** إضافة سريعة لشخص جديد (اسم بس) من داخل فورم التحويل نفسه، بدون ما تنتقل لصفحة ثانية */
async function quickAddWorkerFromConversion(){
  const name = prompt('اسم الشخص الجديد:');
  if (!name || !name.trim()) return;
  showLoading(true);
  const { data, error } = await sb.from('workers').insert({ name: name.trim() }).select('id').single();
  showLoading(false);
  if (error){ showToast('تعذّر إضافة الشخص: ' + error.message, true); return; }
  await loadWorkers();
  document.getElementById('convExecutorWorker').value = data.id;
  showToast('✅ أُضيف "' + name.trim() + '" — تقدر تكمّل بيانات طريقة حسابه لاحقاً من صفحة المحاسبة.');
}

/* ========================= إدارة كاملة (صفحة المحاسبة) ========================= */
async function saveWorker(){
  const id = document.getElementById('workerId').value;
  const name = document.getElementById('workerName').value.trim();
  const notes = document.getElementById('workerNotes').value.trim() || null;
  if (!name){ showToast('اسم الشخص مطلوب.', true); return; }
  showLoading(true);
  const payload = { name, notes };
  const { error } = id
    ? await sb.from('workers').update(payload).eq('id', Number(id))
    : await sb.from('workers').insert(payload);
  showLoading(false);
  if (error){ showToast('تعذّر الحفظ: ' + error.message, true); return; }
  showToast('✅ تم الحفظ.');
  resetWorkerForm();
  await loadWorkers();
}
function resetWorkerForm(){
  document.getElementById('workerId').value = '';
  document.getElementById('workerName').value = '';
  document.getElementById('workerNotes').value = '';
}
function editWorker(id){
  const w = state.workers.find(x => x.id === id);
  if (!w) return;
  document.getElementById('workerId').value = w.id;
  document.getElementById('workerName').value = w.name || '';
  document.getElementById('workerNotes').value = w.notes || '';
  const acc = document.getElementById('accWorkerAdd');
  acc.classList.add('open');
  acc.scrollIntoView({behavior:'smooth', block:'start'});
}
async function deactivateWorker(id){
  if (!confirm('تأكيد إيقاف هذا الشخص؟ (يختفي من قوائم الاختيار المستقبلية، بس كل سجلاته السابقة تبقى محفوظة)')) return;
  showLoading(true);
  const { error } = await sb.from('workers').update({ is_active: false }).eq('id', id);
  showLoading(false);
  if (error){ showToast('تعذّر الإيقاف: ' + error.message, true); return; }
  showToast('تم الإيقاف.');
  await loadWorkers();
}
function renderWorkersManagementList(){
  const el = document.getElementById('workersManagementList');
  if (!el) return;
  if (!state.workers.length){ el.innerHTML = '<div class="hint">ما فيه أشخاص مسجّلين بعد.</div>'; return; }
  el.innerHTML = state.workers.map(w => `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px dashed var(--line);padding:8px 0;font-size:13px;">
      <div><b>${escapeHtml(w.name)}</b>${w.notes ? (' — <span class="hint">' + escapeHtml(w.notes) + '</span>') : ''}</div>
      <div style="display:flex;gap:6px;">
        <button class="btn-sm btn-ghost" onclick="editWorker(${w.id})">✏️ تعديل</button>
        <button class="btn-sm btn-ghost" style="color:var(--debt);" onclick="deactivateWorker(${w.id})">⏸️ إيقاف</button>
      </div>
    </div>`).join('');
}

/** يعدّل طريقة/سعر أجر تمييعة سابقة بعد ما اتسجّلت — مفيد لو أُدخلت غلط وقت التسجيل */
async function editConversionWorkerPricing(conversionId, currentType, currentRate){
  if (!canWrite('warehouse')){ showToast('ليس لديك صلاحية تعديل هذا.', true); return; }
  const typeLabel = prompt('طريقة الحساب — اكتب "تمييعة" أو "كيلو":', currentType==='per_kg' ? 'كيلو' : 'تمييعة');
  if (typeLabel === null) return;
  const newType = typeLabel.trim() === 'كيلو' ? 'per_kg' : 'per_batch';
  const rateStr = prompt('السعر الجديد (ر.س):', currentRate || '');
  if (rateStr === null) return;
  const newRate = Number(rateStr);
  if (!newRate || newRate <= 0){ showToast('سعر غير صالح.', true); return; }
  showLoading(true);
  const { error } = await sb.rpc('fn_update_conversion_worker_pricing', {
    p_conversion_id: conversionId, p_payment_type: newType, p_rate: newRate
  });
  showLoading(false);
  if (error){ showToast('تعذّر التعديل: ' + error.message, true); return; }
  showToast('✅ تم تحديث السعر.');
  loadStockConversionsIntoLog();
}

/** يستدعي دالة حساب المستحق بقاعدة البيانات ويعرض النتيجة */
async function calculateWorkerPaymentUI(){
  const workerId = Number(document.getElementById('workerPaySelect').value) || null;
  const fromDate = document.getElementById('workerPayFrom').value;
  const toDate = document.getElementById('workerPayTo').value;
  const box = document.getElementById('workerPaymentResult');
  if (!workerId){ showToast('اختر شخص أول.', true); return; }
  if (!fromDate || !toDate){ showToast('حدد الفترة (من - إلى).', true); return; }
  box.innerHTML = '<div class="hint">جارِ الحساب…</div>';
  const { data, error } = await sb.rpc('fn_calculate_worker_payment', {
    p_worker_id: workerId, p_from_date: fromDate, p_to_date: toDate
  });
  if (error){ box.innerHTML = '<div class="hint" style="color:var(--debt);">تعذّر الحساب: ' + error.message + '</div>'; return; }
  if (!data.operations_count){
    box.innerHTML = '<div class="hint">ما فيه عمليات مسجّلة لهذا الشخص خلال هذي الفترة.</div>';
    return;
  }
  // كل سطر يُحسب بالسعر المثبّت وقت تسجيله (Snapshot) — قد يظهر السطرين مع بعض لو تغيّرت
  // طريقة حساب العامل (بالتمييعة/بالكيلو) بمنتصف الفترة المحددة، وهذا سلوك صحيح ومقصود.
  const lines = [];
  if (data.total_batches > 0) lines.push('مجموع التمييعات: ' + Number(data.total_batches).toLocaleString() + ' → ' + Number(data.batches_amount).toLocaleString() + ' ر.س');
  if (data.total_kg > 0) lines.push('مجموع الكيلوجرامات: ' + Number(data.total_kg).toLocaleString() + ' → ' + Number(data.kg_amount).toLocaleString() + ' ر.س');
  const warningHtml = data.unset_snapshot_count > 0
    ? `<div class="hint" style="color:var(--debt);margin-top:6px;">⚠️ ${data.unset_snapshot_count} عملية من ضمن الفترة ما كان لها سعر محدد وقت تسجيلها (سُجّلت قبل تحديد طريقة حساب هذا الشخص) — ما دخلت بالمجموع، راجعها يدويًا.</div>`
    : '';
  box.innerHTML = `
    <div class="card" style="background:#eef1e0;">
      <div><b>${escapeHtml(data.worker_name)}</b> — عدد العمليات خلال الفترة: ${data.operations_count}</div>
      <div style="margin-top:6px;">${lines.join('<br>') || '<span class="hint">لا يوجد عمليات محسوبة (راجع التحذير أدناه).</span>'}</div>
      <div style="margin-top:8px;font-size:18px;font-weight:800;color:var(--brass-dark);">المستحق: ${Number(data.amount).toLocaleString()} ر.س</div>
      ${warningHtml}
      <div class="hint" style="margin-top:6px;">كل عملية تُحسب بالسعر اللي كان ساري وقت تسجيلها تحديدًا، حتى لو تغيّر سعر هذا الشخص لاحقًا.</div>
    </div>`;
}
