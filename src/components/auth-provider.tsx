"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { type User } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";

const AuthContext = createContext<User | null>(null);

let sessionInitialization: Promise<User> | undefined;

function ensureAnonymousSession(): Promise<User> {
  if (!sessionInitialization) {
    sessionInitialization = (async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        throw error;
      }

      if (data.session) {
        return data.session.user;
      }

      const { data: signInData, error: signInError } =
        await supabase.auth.signInAnonymously();

      if (signInError) {
        throw signInError;
      }

      if (!signInData.user) {
        throw new Error("Anonymous sign-in returned no user.");
      }

      return signInData.user;
    })().catch((error: unknown) => {
      sessionInitialization = undefined;
      throw error;
    });
  }

  return sessionInitialization;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe = () => {};

    const handleFailure = (error: unknown) => {
      if (!isMounted) {
        return;
      }

      console.error("Supabase session initialization failed.", error);
      setIsLoading(false);
      setHasError(true);
    };

    try {
      const supabase = getSupabaseClient();
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          setUser(session.user);
          setIsLoading(false);
          setHasError(false);
        }
      });

      unsubscribe = () => data.subscription.unsubscribe();

      void ensureAnonymousSession()
        .then((sessionUser) => {
          if (isMounted) {
            setUser(sessionUser);
            setIsLoading(false);
            setHasError(false);
          }
        })
        .catch(handleFailure);
    } catch (error) {
      handleFailure(error);
    }

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [retryCount]);

  if (hasError) {
    return (
      <main
        className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center"
        role="alert"
      >
        <p>Kirjautuminen ei onnistunut. Tarkista verkkoyhteys ja yritä uudelleen.</p>
        <button
          className="min-h-11 rounded-md bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          onClick={() => {
            setHasError(false);
            setIsLoading(true);
            setRetryCount((count) => count + 1);
          }}
          type="button"
        >
          Yritä uudelleen
        </button>
      </main>
    );
  }

  if (isLoading || !user) {
    return (
      <main
        aria-live="polite"
        className="flex min-h-screen flex-col items-center justify-center gap-3"
        role="status"
      >
        <span
          aria-hidden="true"
          className="size-8 animate-spin rounded-full border-[3px] border-emerald-700 border-r-transparent"
        />
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Kirjaudutaan sisään...
        </p>
      </main>
    );
  }

  return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>;
}

export function useAuth(): User {
  const user = useContext(AuthContext);

  if (!user) {
    throw new Error("useAuth must be used within an authenticated AuthProvider.");
  }

  return user;
}