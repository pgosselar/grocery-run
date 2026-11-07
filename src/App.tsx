import { useEffect, useState } from "react";
import { fetchMe, setUserName, startSync, useStore } from "@/lib/store";
import { useRoute } from "@/lib/router";
import { safeStorage, saveStorage } from "@/lib/utils";
import { ListsScreen } from "@/components/ListsScreen";
import { ListScreen } from "@/components/ListScreen";
import { Login } from "@/components/Login";

type Auth = { status: "loading" } | { status: "login"; needsPasscode: boolean } | { status: "ready" };

export default function App() {
  const [auth, setAuth] = useState<Auth>({ status: "loading" });
  const { authError } = useStore();
  const route = useRoute();

  const ready = (name: string) => {
    saveStorage("gr.name", name);
    setUserName(name);
    setAuth({ status: "ready" });
    startSync();
  };

  useEffect(() => {
    fetchMe()
      .then(({ authEnabled, session }) => {
        if (session?.name) ready(session.name);
        else setAuth({ status: "login", needsPasscode: authEnabled && !session });
      })
      .catch(() => {
        // Offline at launch: run from the local cache if we've signed in before.
        const name = safeStorage("gr.name", "");
        if (name) ready(name);
        else setAuth({ status: "login", needsPasscode: true });
      });
  }, []);

  useEffect(() => {
    if (authError) setAuth({ status: "login", needsPasscode: true });
  }, [authError]);

  if (auth.status === "loading") return null;
  if (auth.status === "login") return <Login needsPasscode={auth.needsPasscode} onDone={ready} />;
  return route.name === "list" ? <ListScreen key={route.id} id={route.id} /> : <ListsScreen />;
}
