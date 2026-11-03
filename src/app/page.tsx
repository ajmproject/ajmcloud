export default function HomePage() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ maxWidth: '480px', width: '100%', background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', padding: '2rem', textAlign: 'center' }}>
        <h1 style={{ color: '#38bdf8', fontSize: '1.75rem', marginBottom: '0.5rem' }}>AjmCloud API</h1>
        <p style={{ color: '#9ca3af', fontSize: '0.95rem', lineHeight: '1.6' }}>
          Layanan Backend Serverless untuk aplikasi personal cloud storage AjmCloud.
        </p>
        <div style={{ margin: '1.5rem 0', padding: '0.75rem', background: '#1f2937', borderRadius: '8px', fontSize: '0.85rem', color: '#10b981', fontFamily: 'monospace' }}>
          Status: Operational (v0.1.0)
        </div>
        <p style={{ color: '#6b7280', fontSize: '0.8rem' }}>
          Endpoint dasar: <code>/api/v1</code> &bull; Health check: <code>/api/health</code>
        </p>
      </div>
    </main>
  );
}
