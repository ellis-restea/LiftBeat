import { useLayoutEffect, useState } from "react";

export function setNavDir(dir: "forward" | "back"): void {
  if (typeof window !== "undefined") {
    sessionStorage.setItem("__navDir", dir);
  }
}

export function usePageEnter(): string {
  const [cls, setCls] = useState("");
  useLayoutEffect(() => {
    const dir = sessionStorage.getItem("__navDir");
    sessionStorage.removeItem("__navDir");
    if (!dir) return;
    setCls(dir === "back" ? "page-enter-left" : "page-enter-right");
  }, []);
  return cls;
}
