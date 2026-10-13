export const metadata = { title: "Radar · entrar" }

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b0b0f", color: "#f2f2f5", fontFamily: "system-ui, sans-serif" }}>
      <form method="POST" action="/api/login" style={{ width: 320, display: "grid", gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Radar</h1>
        <p style={{ margin: 0, color: "#9a9aa8", fontSize: 14 }}>Escribí la contraseña (RADAR_PASSWORD).</p>
        <input name="password" type="password" autoFocus required placeholder="Contraseña"
          style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid #2c2c36", background: "#14141b", color: "inherit", fontSize: 15 }} />
        {error ? <p style={{ margin: 0, color: "#ff7b7b", fontSize: 13 }}>Contraseña incorrecta.</p> : null}
        <button type="submit" style={{ padding: "12px 14px", borderRadius: 10, border: 0, background: "#f2f2f5", color: "#0b0b0f", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>Entrar</button>
      </form>
    </main>
  )
}
