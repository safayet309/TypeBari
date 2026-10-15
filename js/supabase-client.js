// Supabase client তৈরি করে (supabase-js লাইব্রেরি আগে লোড হতে হবে)
const sb = window.supabase.createClient(
  window.TYPEBARI_CONFIG.SUPABASE_URL,
  window.TYPEBARI_CONFIG.SUPABASE_ANON_KEY
);
