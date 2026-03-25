"use client";

import {
  useAuth,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/history", label: "History" },
  { href: "/about", label: "About" },
];

export function TopNav() {
  const pathname = usePathname();
  const { isLoaded, isSignedIn } = useAuth();
  const shouldShowAuthButtons = !isLoaded || !isSignedIn;

  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-6">
      <div className="glass-panel mx-auto w-full max-w-330">
      <div className="mx-auto flex h-16 w-full max-w-330 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="headline-md text-high leading-none"
          >
            Truth<span className="text-(--accent)">Lens</span>
          </Link>

          <nav className="hidden items-center gap-1 rounded-full bg-(--surface-container-high)/45 p-1 md:flex">
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-full px-4 py-1.5 text-sm transition ${
                    active
                      ? "bg-(--surface-bright) text-high"
                      : "text-muted hover:text-high"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {shouldShowAuthButtons ? (
            <>
              <SignInButton mode="modal">
                <button className="btn-secondary h-9 cursor-pointer px-3 py-1.5 text-sm">
                  Sign in
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="btn-primary h-9 cursor-pointer px-4 text-sm">Sign up</button>
              </SignUpButton>
            </>
          ) : null}

          {isLoaded && isSignedIn ? <UserButton /> : null}
        </div>
      </div>
      </div>
    </header>
  );
}
