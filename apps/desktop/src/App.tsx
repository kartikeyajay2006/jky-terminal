import { useState } from "react";
import { Shell } from "./app/Shell";
import { ProviderVault } from "./features/settings/ProviderVault";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";

export function App() {
  const [active, setActive] = useState("providers");

  return (
    <Shell activeId={active} onSelect={setActive}>
      {active === "providers" ? <ProviderVault /> : <p>Terminal arrives in Task 6.</p>}
    </Shell>
  );
}
