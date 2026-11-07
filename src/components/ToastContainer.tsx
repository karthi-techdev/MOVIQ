"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

export interface ToastItem {
  id: string;
  message: string;
  isError: boolean;
}

interface ToastContextValue {
  showToast: (message: string, isError?: boolean) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {}
});

export const useToast = () => useContext(ToastContext);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, isError: boolean = false) => {
    setToasts((prev) => {
      // Prevent duplicate consecutive toasts with the exact same message
      if (prev.some((t) => t.message === message)) {
        return prev;
      }
      const id = Math.random().toString(36).slice(2, 9);
      const next = [...prev.slice(-3), { id, message, isError }];
      setTimeout(() => {
        setToasts((curr) => curr.filter((t) => t.id !== id));
      }, 3500);
      return next;
    });
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div id="toast-container" className="toast-container" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast ${toast.isError ? "error" : ""}`}
            role="status"
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
