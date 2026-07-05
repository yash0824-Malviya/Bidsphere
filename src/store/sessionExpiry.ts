import { logoutFromServer } from "../api/auth";

import { clearAllAuthStorage } from "./authStorage";

import { useAuthStore } from "./authStore";



/** Called from the ERPNext HTTP client on 401 responses. */

export function handleSessionExpired(): void {

  const { isAuthenticated } = useAuthStore.getState();

  if (!isAuthenticated) return;



  void logoutFromServer();

  clearAllAuthStorage();

  void useAuthStore.persist.clearStorage();

  useAuthStore.setState({

    user: null,

    isAuthenticated: false,

    isLoading: false,

    isVerifying: false,

    rememberMe: false,

    mfaPending: null,

    sessionProof: null,

    sessionRestoreError: null,

  });



  if (

    typeof window !== "undefined" &&

    !window.location.pathname.startsWith("/login")

  ) {

    window.location.replace("/login");

  }

}

