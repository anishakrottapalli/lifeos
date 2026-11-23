import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./ui/App";
import { StoreContext } from "./ui/hooks";
import { createStorage } from "./core/storage";
import { LifeStore } from "./core/store";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "./styles.css";

async function start() {
  const storage = await createStorage();
  const store = new LifeStore(storage);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <StoreContext.Provider value={store}>
        <App />
      </StoreContext.Provider>
    </React.StrictMode>,
  );
  await store.init();
}

start();
