import { createRoot } from "react-dom/client";
import { CiFinder } from "@ci-finder/react";
import "@ci-finder/react/styles.css";

createRoot(document.getElementById("root")!).render(<CiFinder endpoint="/api/files" />);
