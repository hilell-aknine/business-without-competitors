/**
 * Supabase client — עסק ללא מתחרים
 *
 * Public (anon) credentials. Safe to expose in the browser:
 * Row Level Security (RLS) is enforced server-side on every table.
 *
 * Usage (after the Supabase CDN script is loaded):
 *   const { data, error } = await window.bwcSupabase.auth.getSession();
 *
 * Loading order on a page that needs Supabase:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="/js/supabase-config.js"></script>
 */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://hiosnmkszdktirpfzjqi.supabase.co';
  const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhpb3NubWtzemRrdGlycGZ6anFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MjkyNzksImV4cCI6MjA5NDAwNTI3OX0.05RyNeLVWLXDMUVBV-C7kq2e0hamg5oQttMiKp8UaMQ';

  if (typeof window === 'undefined') return;

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error(
      '[supabase-config] supabase-js was not loaded before supabase-config.js. ' +
        'Include https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2 first.'
    );
    return;
  }

  window.bwcSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'bwc_auth_v1'
    }
  });

  window.bwcSupabaseConfig = Object.freeze({
    url: SUPABASE_URL,
    projectRef: 'hiosnmkszdktirpfzjqi'
  });
})();
