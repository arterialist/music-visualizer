import MusicRealm from "./realms/music/MusicRealm";

const REALM_COLOR = "#ff6ec7";

export default function App() {
  return (
    <div
      className="realm-enter fixed inset-0 overflow-hidden"
      style={{
        background: `radial-gradient(ellipse at 50% 60%, ${REALM_COLOR}14 0%, rgba(5,6,15,0.55) 65%), rgba(5,6,15,0.35)`,
      }}
    >
      <MusicRealm />
    </div>
  );
}
