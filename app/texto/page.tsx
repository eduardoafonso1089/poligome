export default function TextoRedirect() {
  return <main style={{ fontFamily: "sans-serif", padding: "2rem" }}>
    <meta httpEquiv="refresh" content="0;url=/annotate" />
    <link rel="canonical" href="/annotate" />
    <p>Esta rota está temporariamente indisponível. Abra <a href="/annotate">/annotate</a>.</p>
  </main>;
}
