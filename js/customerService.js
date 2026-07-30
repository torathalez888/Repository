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
