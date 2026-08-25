import { useEffect } from "react";
import { applyTheme, loadTheme } from "./app/theme";
import { ProviderVault } from "./features/settings/ProviderVault";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";

export function App() {
  useEffect(() => {
    applyTheme(loadTheme());
  }, []);

  return <ProviderVault />;
}
