import { useEffect, useState } from "react";
import type { AuthInfo, User } from "../shared/types";
import { cachedUser, fetchMe, markSignedOut, startSync, useStore } from "@/lib/store";
import { navigate, useRoute } from "@/lib/router";
import { ListsScreen } from "@/components/ListsScreen";
import { ListScreen } from "@/components/ListScreen";
import { Login } from "@/components/Login";
import { InviteScreen } from "@/components/InviteScreen";
import { ResetPassword } from "@/components/ResetPassword";
import { Toaster } from "@/components/Toaster";

export default function App() {
  const { user } = useStore();
  const route = useRoute();
  const invite = route.name === "invite" ? route.token : null;
  // null while we ask the server who we are
  const [info, setInfo] = useState<AuthInfo | null>(null);

  useEffect(() => {
    fetchMe(invite)
      .then((i) => {
        if (i.user) startSync(i.user);
        else markSignedOut();
        setInfo(i);
      })
      .catch(() => {
        // Offline at launch: run from this phone's copy if someone has signed in here before.
        const u = cachedUser();
        if (u) startSync(u);
        setInfo({ user: u, google: false, signupOpen: false, firstRun: false, email: false });
      });
  }, []);

  // After signing out (or a session expiring), refresh what the sign-in screen should offer.
  useEffect(() => {
    if (info && !user) fetchMe(invite).then(setInfo).catch(() => {});
  }, [user, invite]);

  if (!info) return null;

  if (route.name === "reset") {
    return (
      <ResetPassword
        token={route.token}
        onDone={(u) => {
          startSync(u);
          navigate({ name: "lists" }, true);
        }}
      />
    );
  }

  if (!user) {
    return (
      <Login
        info={info}
        invite={invite}
        onSignedIn={(u: User, listId: string | null) => {
          startSync(u);
          if (listId) navigate({ name: "list", id: listId }, true);
        }}
      />
    );
  }
  if (route.name === "invite") return <InviteScreen token={route.token} />;
  return (
    <>
      {route.name === "list" ? <ListScreen key={route.id} id={route.id} /> : <ListsScreen />}
      <Toaster />
    </>
  );
}
