/** Luz ambiente Sunset atrás de todo o app: é o que o vidro translúcido desfoca. */
export function Ambient() {
  return (
    <>
      <div className="ambient" aria-hidden>
        <span className="orb-1" />
        <span className="orb-2" />
        <span className="orb-3" />
        <span className="orb-4" />
      </div>
      <div className="grain" aria-hidden />
    </>
  );
}
