import ReactDOM from "react-dom/client";
import App from "./App";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./styles.css";

// Note: no StrictMode — it double-mounts effects in dev, which makes the
// Crepe editor instantiate twice and flicker.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
