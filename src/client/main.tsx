import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { ConfirmProvider, ToastProvider } from "./components/ui";
import "./index.css";
import { setUnauthorizedHandler } from "./lib/api";
import { queryClient } from "./lib/queries";
import { router } from "./router";

setUnauthorizedHandler(() => {
  queryClient.setQueryData(["me"], undefined);
  queryClient.invalidateQueries({ queryKey: ["me"] });
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
