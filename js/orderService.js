/* ============================================================
   خدمة الطلبات — تراث العز
   نقطة الحفظ الموحّدة الوحيدة لأي إنشاء أو تعديل على طلب.
   أي زر أو شاشة تحفظ/تعدّل طلب (تسجيل الطلب، تغيير الحالة السريع،
   الحجوزات، أو أي شاشة قادمة) لازم يمر من هنا فقط — بدون استثناء.
   هذا يمنع تكرار نفس منطق الحفظ بأكثر من مكان بالكود.

   ملاحظة: منطق خصم/إرجاع المخزون (delta) والمعاملة الآمنة كلها
   منفّذة داخل دالة قاعدة البيانات fn_save_order نفسها (بمعاملة
   واحدة atomic) — هذا الملف بس نقطة استدعاء موحّدة من الواجهة.
   ============================================================ */

/**
 * يحفظ طلب جديد أو يعدّل طلب موجود.
 * @param {Object} payload - كل حقول fn_save_order (p_order_id, p_customer_phone, ...)
 * @returns {Object} بيانات الطلب المحفوظ (order_id, stock_warnings, ...)
 * @throws يرمي الخطأ لو فشل الحفظ — المستدعي مسؤول عن معالجته (try/catch)
 */
async function saveOrderToDatabase(payload) {
  const { data, error } = await sb.rpc('fn_save_order', payload);
  if (error) throw error;
  return data;
}

/**
 * يحدّث طريقة الدفع وطريقة التوصيل لطلب موجود (حقلين اختياريين).
 * نداء منفصل بسيط بعد نجاح saveOrderToDatabase — بنفس نمط تحديث customer_message
 * الموجود أصلاً بالكود، بدون أي تعديل على دالة fn_save_order الأساسية.
 * @param {number} orderId
 * @param {string} paymentMethod - 'نقدي' | 'تحويل بنكي' | 'آجل' | '' (فاضي = غير محدد)
 * @param {string} deliveryType - 'مندوب داخلي' | 'شركة توصيل خارجية' | 'استلام من المحل' | ''
 */
async function updateOrderDeliveryPaymentInfo(orderId, paymentMethod, deliveryType) {
  const { error } = await sb.from('orders').update({
    payment_method: paymentMethod || null,
    delivery_type: deliveryType || null
  }).eq('id', orderId);
  if (error) throw error;
}

/* ========================= سجل دفعات الطلب (دفعات متعددة، طرق مختلطة) ========================= */
/** يجيب كل الدفعات المسجّلة لطلب معيّن، الأحدث أول */
async function loadOrderPayments(orderId) {
  const { data, error } = await sb.from('order_payments').select('*').eq('order_id', orderId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
/** يضيف دفعة جديدة على طلب — يحدّث المدفوع الكلي ويزامن الديون تلقائياً بقاعدة البيانات */
async function addOrderPayment(orderId, amount, paymentMethod, note) {
  const { data, error } = await sb.rpc('fn_add_order_payment', {
    p_order_id: orderId, p_amount: amount, p_payment_method: paymentMethod || null, p_note: note || null
  });
  if (error) throw error;
  return data;
}
/** يحذف دفعة (لتصحيح خطأ إدخال) — ينقص المدفوع الكلي ويزامن الديون تلقائياً */
async function deleteOrderPayment(paymentId) {
  const { data, error } = await sb.rpc('fn_delete_order_payment', { p_payment_id: paymentId });
  if (error) throw error;
  return data;
}
