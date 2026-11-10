import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./ui/App";
import { StoreContext } from "./ui/hooks";
import { createStorage } from "./core/storage";
import { LifeStore } from "./core/store";
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
