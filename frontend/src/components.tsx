import * as Dialog from "@radix-ui/react-dialog";
import { X, ArrowUpRight, MapPin, Flag, Zap } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  return (
    <button className={twMerge(clsx("btn", variant, className))} {...props} />
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="sr-only">
            {title} form and controls
          </Dialog.Description>
          <Dialog.Close className="dialog-close" aria-label="Close">
            <X size={20} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status.toLowerCase()}`}>
      <span />
      {status.replaceAll("_", " ")}
    </span>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Flag size={28} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <span className="spinner" /> Loading your workspace…
    </div>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div className="error" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Metric({
  label,
  value,
  unit,
  icon,
  note,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  icon: ReactNode;
  note?: string;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        {label}
        <span>{icon}</span>
      </div>
      <div className="metric-value">
        {value}
        <small>{unit}</small>
      </div>
      <div className="metric-note">{note || "From validated run records"}</div>
    </div>
  );
}
export function TrackArt() {
  return (
    <div className="track-art">
      <svg viewBox="0 0 600 380" aria-label="Illustration of a running track">
        <defs>
          <pattern
            id="grid"
            width="30"
            height="30"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 30 0 L 0 0 0 30"
              fill="none"
              stroke="#fff"
              strokeOpacity=".055"
            />
          </pattern>
        </defs>
        <rect width="600" height="380" fill="url(#grid)" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect
            key={i}
            x={115 + i * 12}
            y={45 + i * 12}
            width={370 - i * 24}
            height={290 - i * 24}
            rx={145 - i * 12}
            fill="none"
            stroke={i === 2 ? "#d4f56c" : "#658579"}
            strokeWidth={i === 2 ? 5 : 1.4}
            transform="rotate(-24 300 190)"
          />
        ))}
        <circle
          cx="156"
          cy="247"
          r="10"
          fill="#d4f56c"
          stroke="#102622"
          strokeWidth="4"
        />
        <circle cx="424" cy="96" r="7" fill="white" />
        <path d="m286 149-25 43h26l-12 39 43-53h-29l15-29z" fill="#d4f56c" />
      </svg>
      <span className="track-chip">
        <span className="pulse-dot" />
        Every lap counts
      </span>
    </div>
  );
}
export function SectionTitle({
  title,
  aside,
}: {
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {aside}
    </div>
  );
}
export function Pagination({
  offset,
  setOffset,
  count,
  size = 50,
}: {
  offset: number;
  setOffset: (n: number) => void;
  count: number;
  size?: number;
}) {
  return (
    <div className="pagination">
      <Button
        variant="ghost"
        disabled={!offset}
        onClick={() => setOffset(Math.max(0, offset - size))}
      >
        Previous
      </Button>
      <span>Page {Math.floor(offset / size) + 1}</span>
      <Button
        variant="ghost"
        disabled={count < size}
        onClick={() => setOffset(offset + size)}
      >
        Next
      </Button>
    </div>
  );
}
export { ArrowUpRight, MapPin, Zap };
