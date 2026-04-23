import React from "react";

interface BadgeProps {
  variant: "green" | "gray";
  children: React.ReactNode;
}

export function Badge({ variant, children }: BadgeProps) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}
