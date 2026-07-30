/* ============================================================
   اتصال Supabase الموحّد — تراث العز
   نسخة واحدة فقط لكل الموقع، تُستخدم من index.html وأي ملف قادم.
   ============================================================ */
const SUPABASE_URL = 'https://knwajufdkpdkopblqlok.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_LESH1p3m80TC23I5Os-2hg_kRuihGdr';

window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
